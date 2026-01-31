import { CustomerProfile, getTotalCorpus } from "../models/CustomerProfile";
import { Goal, getBasicTiersSorted, getGoalTarget } from "../models/Goal";
import { AssetClasses, getAssetClassData, AssetClassData } from "../models/AssetClass";
import {
  calculatePortfolioEnvelopeBounds,
  calculateConfidencePercent,
  calculateRequiredSIP,
} from "../engine/envelope";
import {
  AssetAllocation,
  getOptimalAllocation,
  calculateWeightedMetrics,
} from "../engine/portfolio";
import { SIPPlan, AssetAllocation as SIPAssetAllocation } from "../models/SIPPlan";
import {
  GoalFeasibilityTable,
  GoalFeasibilityRow,
  getGoalStatus,
  GoalStatus,
} from "../models/GoalFeasibilityTable";
import {
  SIPAllocationSchedule,
  SIPAllocationSnapshot,
  createInitialSnapshot,
} from "../models/SIPAllocationSchedule";
import { PlanningResult, Method1Result, Method2Result, Method3Result } from "../models/PlanningResult";
import { yearsToMonths } from "../utils/time";
import { roundToNearest1000 } from "../utils/math";
import {
  optimizeCorpusAllocation,
} from "../engine/rebalancer";
import {
  runPortfolioMonteCarloSimulationLognormal,
  calculateMonteCarloBounds,
  calculateMonteCarloConfidence,
  calculateRequiredSIPMonteCarlo,
  runMultiGoalPortfolioMonteCarloLite,
  calculateConfidenceFromPaths,
  SIMULATION_COUNT_LITE,
} from "../engine/montecarlo";
import { calculateNetworthProjection } from "../engine/networthProjection";

/**
 * SIP input parameters for financial planning.
 * 
 * @property monthlySIP - Base monthly SIP contribution amount
 * @property stretchSIPPercent - Percentage increase to calculate maximum SIP (e.g., 20 for 20% increase)
 * @property annualStepUpPercent - Annual percentage increase in SIP amount (e.g., 10 for 10% per year)
 */
export interface SIPInput {
  monthlySIP: number;
  stretchSIPPercent: number;
  annualStepUpPercent: number;
}

/**
 * Planning context containing all inputs for goal planning.
 */
interface PlanningContext {
  assetClasses: AssetClasses;
  customerProfile: CustomerProfile;
  goals: Goal[];
  sipInput: SIPInput;
}

/**
 * State tracking for a goal tier during planning.
 * Stores allocation decisions and projected outcomes for a goal tier.
 */
interface GoalPlanningState {
  goalId: string;
  tier: "basic" | "ambitious";
  allocatedCorpus: number;
  allocatedSIP: number;
  assetAllocation: AssetAllocation[];
  envelopeBounds: { lower: number; mean: number };
  confidencePercent: number;
}

/**
 * Main goal planner class for SIP allocation and corpus optimization.
 * 
 * Implements three planning methods:
 * - Method 1: Envelope method with current corpus allocation
 * - Method 2: Monte Carlo simulation with rebalancing
 * - Method 3: Iterative corpus rebalancing starting from zero corpus
 * 
 * The planner prioritizes securing basic tier goals (90% confidence) before
 * allocating remaining SIP to ambitious tiers.
 */
export class GoalPlanner {
  private context: PlanningContext;
  private goalStates: Map<string, GoalPlanningState> = new Map();

  constructor(context: PlanningContext) {
    this.context = context;
  }

  /**
   * Plan Method 1: With current corpus allocation
   */
  planMethod1(maxIterations: number = 20, monteCarloPaths: number = SIMULATION_COUNT_LITE): Method1Result {
    const { assetClasses, customerProfile, goals, sipInput } = this.context;

    // Sort goals by basic tier priority
    const sortedGoals = getBasicTiersSorted(goals);

    // Separate goals by horizon (< 3 years = short-term, SIP = 0; >= 3 years = long-term)
    const shortTermGoals = sortedGoals.filter((g) => g.horizonYears < 3);
    const longTermGoals = sortedGoals.filter((g) => g.horizonYears >= 3);

    // Handle short-term goals: allocate corpus but set SIP to 0
    const shortTermCorpusAllocation: Record<string, Record<string, number>> = {};
    if (shortTermGoals.length > 0) {
      const goalCorpusRequirements: Record<string, number> = {};
      for (const goal of shortTermGoals) {
        goalCorpusRequirements[goal.goalId] = getGoalTarget(goal, "basic");
      }
      const allocatedCorpus = optimizeCorpusAllocation(
        customerProfile,
        shortTermGoals,
        goalCorpusRequirements
      );
      for (const goal of shortTermGoals) {
        const goalCorpusAlloc = allocatedCorpus[goal.goalId] || {};
        shortTermCorpusAllocation[goal.goalId] = goalCorpusAlloc;
        
        // Store state for short-term goal (no SIP allocation)
        const goalCorpusTotal = Object.values(goalCorpusAlloc).reduce((sum, v) => sum + v, 0);
        const assetAllocation = getOptimalAllocation(
          goal,
          "basic",
          customerProfile.corpus.allowedAssetClasses,
          assetClasses,
          0
        );
        
        const assetClassDataMap: Record<string, any> = {};
        const timeHorizon = "3Y";
        for (const alloc of assetAllocation) {
          const data = getAssetClassData(assetClasses, alloc.assetClass, timeHorizon);
          if (data) {
            assetClassDataMap[alloc.assetClass] = data;
          }
        }
        
        const target = getGoalTarget(goal, "basic");
        const envelopeBounds = calculatePortfolioEnvelopeBounds(
          goalCorpusTotal,
          0, // SIP = 0 for short-term goals
          assetAllocation,
          assetClassDataMap,
          goal.horizonYears,
          0 // No step-up for short-term goals
        );
        
        const confidencePercent = calculateConfidencePercent(target, envelopeBounds);
        
        this.goalStates.set(`${goal.goalId}_basic`, {
          goalId: goal.goalId,
          tier: "basic",
          allocatedCorpus: goalCorpusTotal,
          allocatedSIP: 0,
          assetAllocation,
          envelopeBounds,
          confidencePercent,
        });
      }
    }

    // Calculate available SIP (base + stretch) for long-term goals only
    const stretchSIP = sipInput.monthlySIP * (1 + sipInput.stretchSIPPercent / 100);
    const availableSIP = Math.max(sipInput.monthlySIP, stretchSIP);

    // Start with initial corpus allocation for long-term goals only
    let optimizedCorpus = this.optimizeCorpusAllocation(longTermGoals);

    // Iterate until convergence (only for long-term goals)
    const sipTolerance = 1000; // ₹1000 tolerance for convergence
    let previousSIPAllocations = new Map<string, number>();
    let iterations = 0;
    let converged = false;
    let finalBasicGoalSIP: { totalSIP: number; allocations: Map<string, number> } | null = null;

    while (!converged && iterations < maxIterations && longTermGoals.length > 0) {
      iterations++;

      // Phase 1: Secure basic tier goals (long-term only)
      const basicGoalSIP = this.planBasicTiers(
        longTermGoals,
        optimizedCorpus,
        assetClasses,
        customerProfile,
        availableSIP
      );

      // Check convergence: compare SIP allocations
      converged = true;
      for (const [goalId, currentSIP] of basicGoalSIP.allocations.entries()) {
        const previousSIP = previousSIPAllocations.get(goalId) || 0;
        if (Math.abs(currentSIP - previousSIP) >= sipTolerance) {
          converged = false;
          break;
        }
      }

      // Store final result
      finalBasicGoalSIP = basicGoalSIP;

      if (converged) {
        break;
      }

      // Update previous SIP allocations
      previousSIPAllocations = new Map(basicGoalSIP.allocations);

      // Rebalance corpus to match SIP allocation % (long-term goals only)
      optimizedCorpus = this.rebalanceCorpusToMatchSIPAllocation(
        longTermGoals,
        basicGoalSIP.allocations,
        customerProfile,
        assetClasses,
        shortTermCorpusAllocation
      );
    }

    // Merge short-term and long-term corpus allocations
    const mergedCorpus: Record<string, Record<string, number>> = {
      ...optimizedCorpus,
      ...shortTermCorpusAllocation,
    };

    if (!finalBasicGoalSIP) {
      // If no long-term goals, create empty SIP allocation
      finalBasicGoalSIP = { totalSIP: 0, allocations: new Map() };
    }

    // Phase 2: Allocate remaining SIP to ambitious tiers (long-term goals only)
    const remainingSIP = Math.max(0, availableSIP - finalBasicGoalSIP.totalSIP);
    const ambitiousGoalSIP = this.planAmbitiousTiers(
      longTermGoals,
      optimizedCorpus,
      assetClasses,
      customerProfile,
      remainingSIP
    );

    // Build SIP plan
    const sipPlan = this.buildSIPPlan(finalBasicGoalSIP, ambitiousGoalSIP, availableSIP);

    // Build planning result for portfolio-based feasibility calculation
    const planningResult: Method1Result = {
      method: "method1",
      goalFeasibilityTable: this.buildFeasibilityTable(sortedGoals), // Keep for per-goal bounds
      sipAllocation: sipPlan,
      sipAllocationSchedule: this.buildAllocationSchedule(sortedGoals, sipPlan, sipInput, assetClasses, customerProfile),
      corpusAllocation: mergedCorpus,
    };

    // Build feasibility table based on total portfolio networth
    const feasibilityTable = this.buildFeasibilityTableFromPortfolio(
      planningResult,
      sortedGoals,
      "method1",
      monteCarloPaths
    );

    // Build SIP allocation schedule
    const allocationSchedule = this.buildAllocationSchedule(
      sortedGoals,
      sipPlan,
      sipInput,
      assetClasses,
      customerProfile
    );

    // Get corpus allocation for each goal (merged short-term + long-term)
    const corpusAllocation: Record<string, Record<string, number>> = {};
    for (const goal of sortedGoals) {
      const goalCorpusAlloc = mergedCorpus[goal.goalId] || {};
      // Round corpus amounts to nearest 1000 for display
      const roundedAlloc: Record<string, number> = {};
      for (const [assetClass, amount] of Object.entries(goalCorpusAlloc)) {
        roundedAlloc[assetClass] = roundToNearest1000(amount);
      }
      corpusAllocation[goal.goalId] = roundedAlloc;
    }

    return {
      method: "method1",
      goalFeasibilityTable: feasibilityTable,
      sipAllocation: sipPlan,
      sipAllocationSchedule: allocationSchedule,
      corpusAllocation,
    };
  }

  /**
   * Plan Method 2: Monte Carlo simulation-based planning
   */
  planMethod2(monteCarloPaths: number = 1000, maxIterations: number = 20): Method2Result {
    const { assetClasses, customerProfile, goals, sipInput } = this.context;

    // Validate volatilityPct is present for all asset classes
    for (const assetClass of customerProfile.corpus.allowedAssetClasses) {
      const timeHorizon = "10Y"; // Use longest horizon for validation
      const data = getAssetClassData(assetClasses, assetClass, timeHorizon);
      if (data && !data.volatilityPct) {
        throw new Error(`volatilityPct is required for asset class ${assetClass} in Method 2`);
      }
    }

    // Sort goals by basic tier priority
    const sortedGoals = getBasicTiersSorted(goals);

    // Separate goals by horizon (< 3 years = short-term, SIP = 0; >= 3 years = long-term)
    const shortTermGoals = sortedGoals.filter((g) => g.horizonYears < 3);
    const longTermGoals = sortedGoals.filter((g) => g.horizonYears >= 3);

    // Handle short-term goals: allocate corpus but set SIP to 0
    const shortTermCorpusAllocation: Record<string, Record<string, number>> = {};
    if (shortTermGoals.length > 0) {
      const goalCorpusRequirements: Record<string, number> = {};
      for (const goal of shortTermGoals) {
        goalCorpusRequirements[goal.goalId] = getGoalTarget(goal, "basic");
      }
      const allocatedCorpus = optimizeCorpusAllocation(
        customerProfile,
        shortTermGoals,
        goalCorpusRequirements
      );
      for (const goal of shortTermGoals) {
        const goalCorpusAlloc = allocatedCorpus[goal.goalId] || {};
        shortTermCorpusAllocation[goal.goalId] = goalCorpusAlloc;
        
        // Store state for short-term goal (no SIP allocation)
        const goalCorpusTotal = Object.values(goalCorpusAlloc).reduce((sum, v) => sum + v, 0);
        const assetAllocation = getOptimalAllocation(
          goal,
          "basic",
          customerProfile.corpus.allowedAssetClasses,
          assetClasses,
          0
        );
        
        const assetClassDataMap: Record<string, AssetClassData> = {};
        const timeHorizon = "3Y";
        for (const alloc of assetAllocation) {
          const data = getAssetClassData(assetClasses, alloc.assetClass, timeHorizon);
          if (data) {
            assetClassDataMap[alloc.assetClass] = data;
          }
        }
        
        // Run Monte Carlo with SIP = 0 to get bounds
        const monthlySIPByAssetClass: Record<string, number> = {}; // Empty - no SIP
        const paths = runPortfolioMonteCarloSimulationLognormal(
          goalCorpusAlloc,
          monthlySIPByAssetClass,
          assetAllocation,
          assetClassDataMap,
          goal.horizonYears,
          monteCarloPaths,
          0 // No step-up for short-term goals
        );
        
        const bounds = calculateMonteCarloBounds(paths);
        const target = getGoalTarget(goal, "basic");
        const confidencePercent = Math.round(calculateMonteCarloConfidence(paths, target));
        
        this.goalStates.set(`${goal.goalId}_basic`, {
          goalId: goal.goalId,
          tier: "basic",
          allocatedCorpus: goalCorpusTotal,
          allocatedSIP: 0,
          assetAllocation,
          envelopeBounds: bounds,
          confidencePercent,
        });
      }
    }

    // Calculate available SIP (base + stretch) for long-term goals only
    const stretchSIP = sipInput.monthlySIP * (1 + sipInput.stretchSIPPercent / 100);
    const availableSIP = Math.max(sipInput.monthlySIP, stretchSIP);

    // Start with initial corpus allocation for long-term goals only
    let optimizedCorpus = this.optimizeCorpusAllocation(longTermGoals);

    // Iterate until convergence (only for long-term goals)
    const sipTolerance = 1000; // ₹1000 tolerance for convergence
    let previousSIPAllocations = new Map<string, number>();
    let iterations = 0;
    let converged = false;
    let finalBasicGoalSIP: { totalSIP: number; allocations: Map<string, number> } | null = null;

    while (!converged && iterations < maxIterations && longTermGoals.length > 0) {
      iterations++;

      // Phase 1: Secure basic tier goals using Monte Carlo (long-term only)
      const basicGoalSIP = this.planBasicTiersMonteCarlo(
        longTermGoals,
        optimizedCorpus,
        assetClasses,
        customerProfile,
        availableSIP,
        monteCarloPaths
      );

      // Check convergence: compare SIP allocations
      converged = true;
      for (const [goalId, currentSIP] of basicGoalSIP.allocations.entries()) {
        const previousSIP = previousSIPAllocations.get(goalId) || 0;
        if (Math.abs(currentSIP - previousSIP) >= sipTolerance) {
          converged = false;
          break;
        }
      }

      // Store final result
      finalBasicGoalSIP = basicGoalSIP;

      if (converged) {
        break;
      }

      // Update previous SIP allocations
      previousSIPAllocations = new Map(basicGoalSIP.allocations);

      // Rebalance corpus to match SIP allocation % (long-term goals only)
      optimizedCorpus = this.rebalanceCorpusToMatchSIPAllocation(
        longTermGoals,
        basicGoalSIP.allocations,
        customerProfile,
        assetClasses,
        shortTermCorpusAllocation
      );
    }

    // Merge short-term and long-term corpus allocations
    const mergedCorpus: Record<string, Record<string, number>> = {
      ...optimizedCorpus,
      ...shortTermCorpusAllocation,
    };

    if (!finalBasicGoalSIP) {
      // If no long-term goals, create empty SIP allocation
      finalBasicGoalSIP = { totalSIP: 0, allocations: new Map() };
    }

    // Phase 2: Allocate remaining SIP to ambitious tiers using Monte Carlo (long-term goals only)
    const remainingSIP = Math.max(0, availableSIP - finalBasicGoalSIP.totalSIP);
    const ambitiousGoalSIP = this.planAmbitiousTiersMonteCarlo(
      longTermGoals,
      optimizedCorpus,
      assetClasses,
      customerProfile,
      remainingSIP,
      monteCarloPaths
    );

    // Build SIP plan
    const sipPlan = this.buildSIPPlan(finalBasicGoalSIP, ambitiousGoalSIP, availableSIP);

    // Get corpus allocation for each goal (merged short-term + long-term)
    const corpusAllocation: Record<string, Record<string, number>> = {};
    for (const goal of sortedGoals) {
      const goalCorpusAlloc = mergedCorpus[goal.goalId];
      if (goalCorpusAlloc) {
        corpusAllocation[goal.goalId] = { ...goalCorpusAlloc };
      }
    }

    // Build SIP allocation schedule
    const allocationSchedule = this.buildAllocationSchedule(
      sortedGoals,
      sipPlan,
      sipInput,
      assetClasses,
      customerProfile
    );

    // Build planning result for portfolio-based feasibility calculation
    const planningResult: Method2Result = {
      method: "method2",
      goalFeasibilityTable: this.buildFeasibilityTableMonteCarlo(sortedGoals, monteCarloPaths), // Keep for per-goal bounds
      sipAllocation: sipPlan,
      sipAllocationSchedule: allocationSchedule,
      corpusAllocation: mergedCorpus,
    };

    // Build feasibility table based on total portfolio networth
    const feasibilityTable = this.buildFeasibilityTableFromPortfolio(
      planningResult,
      sortedGoals,
      "method2",
      monteCarloPaths
    );

    return {
      method: "method2",
      goalFeasibilityTable: feasibilityTable,
      sipAllocation: sipPlan,
      sipAllocationSchedule: allocationSchedule,
      corpusAllocation,
    };
  }

  /**
   * Plan Method 3: Iterative corpus rebalancing to match SIP allocation
   * For goals >= 3 years: Calculate SIP with corpus=0, rebalance corpus to match SIP allocation, iterate
   * For goals < 3 years: Allocate corpus but skip SIP calculations (SIP = 0)
   */
  planMethod3(monteCarloPaths: number = 1000, maxIterations: number = 20): Method3Result {
    const { assetClasses, customerProfile, goals, sipInput } = this.context;

    // Validate volatilityPct is present for all asset classes
    for (const assetClass of customerProfile.corpus.allowedAssetClasses) {
      const timeHorizon = "10Y"; // Use longest horizon for validation
      const data = getAssetClassData(assetClasses, assetClass, timeHorizon);
      if (data && !data.volatilityPct) {
        throw new Error(`volatilityPct is required for asset class ${assetClass} in Method 3`);
      }
    }

    // Sort goals by basic tier priority
    const sortedGoals = getBasicTiersSorted(goals);

    // Separate goals by horizon
    const longTermGoals = sortedGoals.filter((g) => g.horizonYears >= 3);
    const shortTermGoals = sortedGoals.filter((g) => g.horizonYears < 3);

    // Step 1: Handle short-term goals (< 3 years)
    // Allocate corpus based on priority and basic tier target, but skip SIP calculations
    const shortTermCorpusAllocation: Record<string, Record<string, number>> = {};
    if (shortTermGoals.length > 0) {
      // Calculate corpus requirements for short-term goals (basic tier target amounts)
      // Use priority-based allocation to avoid disproportionate corpus allocation
      const goalCorpusRequirements: Record<string, number> = {};
      for (const goal of shortTermGoals) {
        // Use basic tier target as the corpus requirement (capped at target)
        goalCorpusRequirements[goal.goalId] = getGoalTarget(goal, "basic");
      }

      // Allocate corpus based on priority (using optimizeCorpusAllocation which handles priority)
      const allocatedCorpus = optimizeCorpusAllocation(
        customerProfile,
        shortTermGoals,
        goalCorpusRequirements
      );

      for (const goal of shortTermGoals) {
        const goalCorpusAlloc = allocatedCorpus[goal.goalId] || {};
        const goalCorpusTotal = Object.values(goalCorpusAlloc).reduce((sum, v) => sum + v, 0);
        
        // Get optimal allocation for this goal (static, no time-based shifts for short-term)
        // Use currentMonth = 0 to get base allocation without time-based shifts
        const assetAllocation = getOptimalAllocation(
          goal,
          "basic",
          customerProfile.corpus.allowedAssetClasses,
          assetClasses,
          0 // No time-based shifts for short-term goals
        );

        // Allocate corpus by asset class to match this goal's allocation %
        const finalGoalCorpusAlloc: Record<string, number> = {};
        for (const alloc of assetAllocation) {
          if (alloc.assetClass === "cash") continue;
          finalGoalCorpusAlloc[alloc.assetClass] = goalCorpusTotal * (alloc.percentage / 100);
        }
        shortTermCorpusAllocation[goal.goalId] = finalGoalCorpusAlloc;

        // Calculate confidence based on corpus growth alone (no SIP)
        // Build asset class data map
        const assetClassDataMap: Record<string, AssetClassData> = {};
        const timeHorizon = goal.horizonYears <= 3 ? "3Y" : goal.horizonYears <= 5 ? "5Y" : "10Y";
        for (const alloc of assetAllocation) {
          const data = getAssetClassData(assetClasses, alloc.assetClass, timeHorizon);
          if (data) {
            assetClassDataMap[alloc.assetClass] = data;
          }
        }

        // Run Monte Carlo with SIP = 0 to get bounds based on corpus growth alone
        const monthlySIPByAssetClass: Record<string, number> = {}; // Empty - no SIP
        const paths = runPortfolioMonteCarloSimulationLognormal(
          finalGoalCorpusAlloc,
          monthlySIPByAssetClass,
          assetAllocation,
          assetClassDataMap,
          goal.horizonYears,
          monteCarloPaths,
          0 // No step-up for short-term goals
        );

        const bounds = calculateMonteCarloBounds(paths);
        const target = getGoalTarget(goal, "basic");
        const confidencePercent = Math.round(calculateMonteCarloConfidence(paths, target));

        // Store state with SIP = 0
        this.goalStates.set(`${goal.goalId}_basic`, {
          goalId: goal.goalId,
          tier: "basic",
          allocatedCorpus: goalCorpusTotal,
          allocatedSIP: 0,
          assetAllocation,
          envelopeBounds: bounds,
          confidencePercent,
        });
      }
    }

    // Step 2: Handle long-term goals (>= 3 years) with iterative rebalancing
    let optimizedCorpus: Record<string, Record<string, number>> = {};
    const sipTolerance = 1000; // ₹1000 tolerance for convergence

    if (longTermGoals.length > 0) {
      // Calculate available SIP (base + stretch)
      const stretchSIP = sipInput.monthlySIP * (1 + sipInput.stretchSIPPercent / 100);
      const availableSIP = Math.max(sipInput.monthlySIP, stretchSIP);

      // Start with empty corpus for long-term goals (Step 1: assume corpus = 0)
      optimizedCorpus = {};
      for (const goal of longTermGoals) {
        optimizedCorpus[goal.goalId] = {};
      }
      
      // Iterate until convergence
      let previousSIPAllocations = new Map<string, number>();
      let iterations = 0;
      let converged = false;
      let finalBasicGoalSIP: { totalSIP: number; allocations: Map<string, number> } | null = null;

      while (!converged && iterations < maxIterations) {
        iterations++;

        // Phase 1: Calculate required SIP for basic tier goals with current corpus
        const basicGoalSIP = this.planBasicTiersMonteCarloWithCorpus(
          longTermGoals,
          optimizedCorpus,
          assetClasses,
          customerProfile,
          availableSIP,
          monteCarloPaths
        );

        // Check convergence: compare SIP allocations
        converged = true;
        for (const [goalId, currentSIP] of basicGoalSIP.allocations.entries()) {
          const previousSIP = previousSIPAllocations.get(goalId) || 0;
          if (Math.abs(currentSIP - previousSIP) >= sipTolerance) {
            converged = false;
            break;
          }
        }

        // Store final result
        finalBasicGoalSIP = basicGoalSIP;

        if (converged) {
          break;
        }

        // Update previous SIP allocations
        previousSIPAllocations = new Map(basicGoalSIP.allocations);

        // Rebalance corpus to match SIP allocation %
        optimizedCorpus = this.rebalanceCorpusToMatchSIPAllocation(
          longTermGoals,
          basicGoalSIP.allocations,
          customerProfile,
          assetClasses,
          shortTermCorpusAllocation
        );
      }

      if (!finalBasicGoalSIP) {
        throw new Error("Failed to calculate basic goal SIP in Method 3");
      }

      // Phase 2: Allocate remaining SIP to ambitious tiers
      const remainingSIP = Math.max(0, availableSIP - Array.from(finalBasicGoalSIP.allocations.values()).reduce((sum, sip) => sum + sip, 0));
      const ambitiousGoalSIP = this.planAmbitiousTiersMonteCarlo(
        longTermGoals,
        optimizedCorpus,
        assetClasses,
        customerProfile,
        remainingSIP,
        monteCarloPaths
      );

      // Build SIP plan
      const sipPlan = this.buildSIPPlan(finalBasicGoalSIP, ambitiousGoalSIP, availableSIP);

      // Merge corpus allocations (long-term + short-term)
      const corpusAllocation: Record<string, Record<string, number>> = {
        ...optimizedCorpus,
        ...shortTermCorpusAllocation,
      };

      // Build SIP allocation schedule
      const allocationSchedule = this.buildAllocationSchedule(
        sortedGoals,
        sipPlan,
        sipInput,
        assetClasses,
        customerProfile
      );

      // Build planning result for portfolio-based feasibility calculation
      const planningResult: Method3Result = {
        method: "method3",
        goalFeasibilityTable: this.buildFeasibilityTableMonteCarlo(sortedGoals, monteCarloPaths), // Keep for per-goal bounds
        sipAllocation: sipPlan,
        sipAllocationSchedule: allocationSchedule,
        corpusAllocation,
      };

      // Build feasibility table based on total portfolio networth
      const feasibilityTable = this.buildFeasibilityTableFromPortfolio(
        planningResult,
        sortedGoals,
        "method3",
        monteCarloPaths
      );

      return {
        method: "method3",
        goalFeasibilityTable: feasibilityTable,
        sipAllocation: sipPlan,
        sipAllocationSchedule: allocationSchedule,
        corpusAllocation,
      };
    } else {
      // Only short-term goals
      // Build SIP plan with zero SIP
      const sipPlan: SIPPlan = {
        totalMonthlySIP: 0,
        perGoalAllocations: [],
        perAssetClassAllocations: [],
        goalAssetAllocations: Array.from(this.goalStates.entries()).map(([key, state]) => ({
          goalId: key,
          allocations: state.assetAllocation.map((a) => ({
            assetClass: a.assetClass,
            percentage: Math.round(a.percentage),
          })),
        })),
      };

      const allocationSchedule = this.buildAllocationSchedule(
        sortedGoals,
        sipPlan,
        sipInput,
        assetClasses,
        customerProfile
      );

      // Build planning result for portfolio-based feasibility calculation
      const planningResult: Method3Result = {
        method: "method3",
        goalFeasibilityTable: this.buildFeasibilityTableMonteCarlo(sortedGoals, monteCarloPaths), // Keep for per-goal bounds
        sipAllocation: sipPlan,
        sipAllocationSchedule: allocationSchedule,
        corpusAllocation: shortTermCorpusAllocation,
      };

      // Build feasibility table based on total portfolio networth
      const feasibilityTable = this.buildFeasibilityTableFromPortfolio(
        planningResult,
        sortedGoals,
        "method3",
        monteCarloPaths
      );

      return {
        method: "method3",
        goalFeasibilityTable: feasibilityTable,
        sipAllocation: sipPlan,
        sipAllocationSchedule: allocationSchedule,
        corpusAllocation: shortTermCorpusAllocation,
      };
    }
  }

  /**
   * Optimizes corpus allocation across goals by calculating requirements proportionally.
   * This is a convenience wrapper that calculates requirements based on target amounts
   * and then delegates to optimizeCorpusAllocation.
   * 
   * @param goals - Goals to allocate corpus for
   * @returns Map of goal IDs to their corpus allocations by asset class
   */
  private optimizeCorpusAllocationForGoals(
    goals: Goal[]
  ): Record<string, Record<string, number>> {
    const goalRequirements: Record<string, number> = {};
    const totalCorpus = getTotalCorpus(this.context.customerProfile);

    // Calculate required corpus for each goal (proportional to target amounts)
    if (goals.length === 1) {
      const goal = goals[0];
      goalRequirements[goal.goalId] = totalCorpus;
    } else {
      const totalTarget = goals.reduce((sum, goal) => sum + getGoalTarget(goal, "basic"), 0);
      for (const goal of goals) {
        const target = getGoalTarget(goal, "basic");
        goalRequirements[goal.goalId] = totalTarget > 0 ? (target / totalTarget) * totalCorpus : 0;
      }
    }

    return optimizeCorpusAllocation(
      this.context.customerProfile,
      goals,
      goalRequirements
    );
  }

  /**
   * Rebalance corpus to match SIP allocation % across goals
   * Calculates weighted average SIP allocation % across goals, then allocates corpus proportionally
   */
  private rebalanceCorpusToMatchSIPAllocation(
    goals: Goal[],
    sipAllocations: Map<string, number>,
    customerProfile: CustomerProfile,
    assetClasses: AssetClasses,
    shortTermCorpusAllocation?: Record<string, Record<string, number>>
  ): Record<string, Record<string, number>> {
    const totalCorpus = getTotalCorpus(customerProfile);
    const totalSIP = Array.from(sipAllocations.values()).reduce((sum, sip) => sum + sip, 0);

    // Calculate corpus available for long-term goals (total minus short-term allocation)
    const shortTermCorpusTotal = shortTermCorpusAllocation
      ? Object.values(shortTermCorpusAllocation).reduce(
          (sum, goalAlloc) => sum + Object.values(goalAlloc).reduce((s, v) => s + v, 0),
          0
        )
      : 0;
    const availableCorpus = totalCorpus - shortTermCorpusTotal;

    if (totalSIP === 0 || availableCorpus <= 0) {
      return this.optimizeCorpusAllocationForGoals(goals);
    }

    // Allocate corpus proportionally to goals based on target amounts
    const goalCorpusRequirements: Record<string, number> = {};
    const totalTarget = goals.reduce((sum, goal) => sum + getGoalTarget(goal, "basic"), 0);

    for (const goal of goals) {
      const target = getGoalTarget(goal, "basic");
      goalCorpusRequirements[goal.goalId] = totalTarget > 0 
        ? (target / totalTarget) * availableCorpus 
        : 0;
    }

    // Allocate corpus to each goal, then within each goal by asset class to match that goal's own SIP allocation %
    const goalAllocations: Record<string, Record<string, number>> = {};

    for (const goal of goals) {
      const goalCorpus = goalCorpusRequirements[goal.goalId] || 0;
      const goalSIP = sipAllocations.get(goal.goalId) || 0;
      
      // Get optimal asset allocation for this goal (this is the SIP allocation %)
      const assetAllocation = getOptimalAllocation(
        goal,
        "basic",
        customerProfile.corpus.allowedAssetClasses,
        assetClasses
      );

      // Allocate corpus by asset class to match this goal's own SIP allocation %
      const goalAllocation: Record<string, number> = {};
      for (const alloc of assetAllocation) {
        if (alloc.assetClass === "cash") continue;
        goalAllocation[alloc.assetClass] = goalCorpus * (alloc.percentage / 100);
      }

      goalAllocations[goal.goalId] = goalAllocation;
    }

    return goalAllocations;
  }

  /**
   * Plan basic tier goals using Monte Carlo with given corpus allocation
   */
  private planBasicTiersMonteCarloWithCorpus(
    goals: Goal[],
    optimizedCorpus: Record<string, Record<string, number>>,
    assetClasses: AssetClasses,
    customerProfile: CustomerProfile,
    availableSIP: number,
    monteCarloPaths: number
  ): { totalSIP: number; allocations: Map<string, number> } {
    const requiredSIPs = new Map<string, number>();
    const goalData = new Map<string, {
      goal: Goal;
      corpusByAssetClass: Record<string, number>;
      assetAllocation: AssetAllocation[];
      assetClassDataMap: Record<string, AssetClassData>;
    }>();

    // Step 1: Calculate required SIP for each goal using Monte Carlo
    for (const goal of goals) {
      const goalCorpusAllocation = optimizedCorpus[goal.goalId] || {};
      const target = getGoalTarget(goal, "basic");

      // Get optimal asset allocation
      const assetAllocation = getOptimalAllocation(
        goal,
        "basic",
        customerProfile.corpus.allowedAssetClasses,
        assetClasses
      );

      // Build asset class data map
      const assetClassDataMap: Record<string, AssetClassData> = {};
      const timeHorizon = goal.horizonYears <= 3 ? "3Y" : goal.horizonYears <= 5 ? "5Y" : "10Y";

      for (const alloc of assetAllocation) {
        const data = getAssetClassData(assetClasses, alloc.assetClass, timeHorizon);
        if (data) {
          assetClassDataMap[alloc.assetClass] = data;
        }
      }

      // Calculate required SIP using Monte Carlo
      // If corpus is empty, use empty corpus; otherwise use allocated corpus
      const corpusToUse = Object.keys(goalCorpusAllocation).length === 0 
        ? {} 
        : goalCorpusAllocation;
      
      const requiredSIP = calculateRequiredSIPMonteCarlo(
        target,
        corpusToUse,
        assetAllocation,
        assetClassDataMap,
        goal.horizonYears,
        monteCarloPaths,
        50, // maxIterations
        this.context.sipInput.annualStepUpPercent
      );

      requiredSIPs.set(goal.goalId, requiredSIP);
      goalData.set(goal.goalId, {
        goal,
        corpusByAssetClass: goalCorpusAllocation,
        assetAllocation,
        assetClassDataMap,
      });
    }

    // Step 2: Calculate total required SIP
    const totalRequiredSIP = Array.from(requiredSIPs.values()).reduce((sum, sip) => sum + sip, 0);

    // Step 3: Allocate SIP
    const allocations = new Map<string, number>();
    let remainingSIP = availableSIP;

    if (totalRequiredSIP <= availableSIP) {
      // Enough SIP available, use required amounts
      for (const [goalId, requiredSIP] of requiredSIPs.entries()) {
        allocations.set(goalId, requiredSIP);
        remainingSIP -= requiredSIP;
      }
    } else {
      // Not enough SIP - allocate based on priority
      const goalIds = Array.from(requiredSIPs.keys());
      
      for (const goalId of goalIds) {
        const requiredSIP = requiredSIPs.get(goalId)!;
        if (remainingSIP >= requiredSIP) {
          allocations.set(goalId, requiredSIP);
          remainingSIP -= requiredSIP;
        } else {
          if (remainingSIP > 0) {
            allocations.set(goalId, remainingSIP);
            remainingSIP = 0;
          } else {
            allocations.set(goalId, 0);
          }
        }
      }
    }

    // Step 4: Store state for each goal with allocated SIP
    for (const [goalId, allocatedSIP] of allocations.entries()) {
      const data = goalData.get(goalId);
      if (!data) continue;

      // Calculate SIP allocation by asset class
      const monthlySIPByAssetClass: Record<string, number> = {};
      for (const alloc of data.assetAllocation) {
        if (alloc.assetClass === "cash") continue;
        monthlySIPByAssetClass[alloc.assetClass] = (allocatedSIP * alloc.percentage) / 100;
      }

      // Run Monte Carlo to get bounds
      const paths = runPortfolioMonteCarloSimulationLognormal(
        data.corpusByAssetClass,
        monthlySIPByAssetClass,
        data.assetAllocation,
        data.assetClassDataMap,
        data.goal.horizonYears,
        monteCarloPaths,
        this.context.sipInput.annualStepUpPercent
      );

      const bounds = calculateMonteCarloBounds(paths);
      const target = getGoalTarget(data.goal, "basic");
      const confidencePercent = Math.round(calculateMonteCarloConfidence(paths, target));

      this.goalStates.set(`${goalId}_basic`, {
        goalId,
        tier: "basic",
        allocatedCorpus: Object.values(data.corpusByAssetClass).reduce((sum, v) => sum + v, 0),
        allocatedSIP,
        assetAllocation: data.assetAllocation,
        envelopeBounds: bounds,
        confidencePercent,
      });
    }

    const totalSIP = Array.from(allocations.values()).reduce((sum, sip) => sum + sip, 0);
    return { totalSIP, allocations };
  }

  /**
   * Optimize corpus allocation across goals
   */
  private optimizeCorpusAllocation(goals: Goal[]): Record<string, Record<string, number>> {
    const goalRequirements: Record<string, number> = {};
    const totalCorpus = getTotalCorpus(this.context.customerProfile);

    // Calculate required corpus for each goal (basic tier)
    // For single goal, allocate all available corpus to that goal
    // For multiple goals, allocate proportionally based on target amounts
    if (goals.length === 1) {
      // Single goal: allocate all corpus to this goal
      const goal = goals[0];
      goalRequirements[goal.goalId] = totalCorpus;
    } else {
      // Multiple goals: allocate proportionally based on target amounts
      const totalTarget = goals.reduce((sum, goal) => sum + getGoalTarget(goal, "basic"), 0);
      for (const goal of goals) {
        const target = getGoalTarget(goal, "basic");
        goalRequirements[goal.goalId] = (target / totalTarget) * totalCorpus;
      }
    }

    return optimizeCorpusAllocation(
      this.context.customerProfile,
      goals,
      goalRequirements
    );
  }

  /**
   * Plan basic tier goals
   */
  private planBasicTiers(
    goals: Goal[],
    optimizedCorpus: Record<string, Record<string, number>>,
    assetClasses: AssetClasses,
    customerProfile: CustomerProfile,
    availableSIP: number
  ): { totalSIP: number; allocations: Map<string, number> } {
    const requiredSIPs = new Map<string, number>();
    const goalData = new Map<string, {
      goal: Goal;
      corpus: number;
      assetAllocation: AssetAllocation[];
      assetClassDataMap: Record<string, any>;
    }>();

    // Step 1: Calculate required SIP for each goal
    for (const goal of goals) {
      const goalCorpusAllocation = optimizedCorpus[goal.goalId] || {};
      const goalCorpus = Object.values(goalCorpusAllocation).reduce(
        (sum: number, v: number) => sum + v,
        0
      );
      const target = getGoalTarget(goal, "basic");

      // Get optimal asset allocation
      const assetAllocation = getOptimalAllocation(
        goal,
        "basic",
        customerProfile.corpus.allowedAssetClasses,
        assetClasses
      );

      // Build asset class data map
      const assetClassDataMap: Record<string, any> = {};
      const timeHorizon = goal.horizonYears <= 3 ? "3Y" : goal.horizonYears <= 5 ? "5Y" : "10Y";

      for (const alloc of assetAllocation) {
        const data = getAssetClassData(assetClasses, alloc.assetClass, timeHorizon);
        if (data) {
          assetClassDataMap[alloc.assetClass] = data;
        }
      }

      // Calculate required SIP for 90% confidence
      const portfolioMetrics = calculateWeightedMetrics(assetAllocation, assetClassDataMap);
      // Create a synthetic AssetClassData for calculateRequiredSIP using weighted portfolio metrics
      // Calculate weighted risk metrics
      let weightedProbNegative = 0;
      let weightedExpectedShortfall = 0;
      let weightedMaxDrawdown = 0;
      let totalWeight = 0;
      
      for (const alloc of assetAllocation) {
        if (alloc.assetClass === "cash") continue;
        const data = assetClassDataMap[alloc.assetClass];
        if (!data) continue;
        const weight = alloc.percentage / 100;
        totalWeight += weight;
        weightedProbNegative += data.probNegativeYearPct * weight;
        weightedExpectedShortfall += data.expectedShortfallPct * weight;
        weightedMaxDrawdown += data.maxDrawdownPct * weight;
      }
      
      if (totalWeight > 0) {
        weightedProbNegative /= totalWeight;
        weightedExpectedShortfall /= totalWeight;
        weightedMaxDrawdown /= totalWeight;
      }
      
      const syntheticData: AssetClassData = {
        avgReturnPct: portfolioMetrics.return * 100,
        probNegativeYearPct: weightedProbNegative,
        expectedShortfallPct: weightedExpectedShortfall,
        maxDrawdownPct: weightedMaxDrawdown,
      };
      const requiredSIP = calculateRequiredSIP(
        target,
        goalCorpus,
        syntheticData,
        goal.horizonYears,
        this.context.sipInput.annualStepUpPercent
      );

      requiredSIPs.set(goal.goalId, requiredSIP);
      goalData.set(goal.goalId, {
        goal,
        corpus: goalCorpus,
        assetAllocation,
        assetClassDataMap,
      });
    }

    // Step 2: Calculate total required SIP
    const totalRequiredSIP = Array.from(requiredSIPs.values()).reduce((sum, sip) => sum + sip, 0);

    // Step 3: Allocate SIP - prioritize ensuring lower >= target for basic tier goals
    const allocations = new Map<string, number>();
    let remainingSIP = availableSIP;
    
    // Use a tolerance (1% of availableSIP or 100, whichever is smaller) to handle precision issues
    // When requiredSIP is very close to availableSIP, use availableSIP to ensure goal can be met
    const sipTolerance = Math.min(availableSIP * 0.01, 100);

    if (totalRequiredSIP <= availableSIP + sipTolerance) {
      // Enough SIP available, use required amounts (or availableSIP if very close for single goal)
      for (const [goalId, requiredSIP] of requiredSIPs.entries()) {
        // For single goal, if requiredSIP is very close to availableSIP, use availableSIP to ensure goal can be met
        // This handles precision issues when stretch SIP and step-up are combined
        const allocatedSIP = (requiredSIPs.size === 1 && (availableSIP - requiredSIP) < sipTolerance && requiredSIP > 0)
          ? availableSIP
          : requiredSIP;
        allocations.set(goalId, allocatedSIP);
        remainingSIP -= allocatedSIP;
      }
    } else {
      // Not enough SIP - allocate based on priority to maximize "can_be_met" goals
      // Sort goals by priority (already sorted, but ensure we process in order)
      const goalIds = Array.from(requiredSIPs.keys()); // Goals are already in priority order
      
      // First pass: Allocate full required SIP to goals we can fully fund
      for (const goalId of goalIds) {
        const requiredSIP = requiredSIPs.get(goalId)!;
        if (remainingSIP >= requiredSIP) {
          allocations.set(goalId, requiredSIP);
          remainingSIP -= requiredSIP;
        } else {
          // Not enough for this goal, allocate what we can proportionally
          // but this means lower < target, so it won't be "can_be_met"
          if (remainingSIP > 0) {
            allocations.set(goalId, remainingSIP);
            remainingSIP = 0;
          } else {
            allocations.set(goalId, 0);
          }
        }
      }
    }

    // Step 4: Store state for each goal with allocated SIP
    for (const [goalId, allocatedSIP] of allocations.entries()) {
      const data = goalData.get(goalId);
      if (!data) continue;

      const { goal, corpus, assetAllocation, assetClassDataMap } = data;
      const target = getGoalTarget(goal, "basic");

      // Recalculate envelope bounds with allocated SIP
      const envelopeBounds = calculatePortfolioEnvelopeBounds(
        corpus,
        allocatedSIP,
        assetAllocation,
        assetClassDataMap,
        goal.horizonYears,
        this.context.sipInput.annualStepUpPercent
      );

      const confidencePercent = calculateConfidencePercent(target, envelopeBounds);
      
      // Use confidence as-is; getGoalStatus handles status determination with tolerance
      const finalConfidence = confidencePercent;

      this.goalStates.set(`${goalId}_basic`, {
        goalId,
        tier: "basic",
        allocatedCorpus: corpus,
        allocatedSIP,
        assetAllocation,
        envelopeBounds,
        confidencePercent: finalConfidence,
      });
    }

    // Calculate total allocated SIP
    const totalAllocatedSIP = Array.from(allocations.values()).reduce((sum, sip) => sum + sip, 0);
    return { totalSIP: totalAllocatedSIP, allocations };
  }

  /**
   * Plan ambitious tier goals
   */
  private planAmbitiousTiers(
    goals: Goal[],
    optimizedCorpus: Record<string, Record<string, number>>,
    assetClasses: AssetClasses,
    customerProfile: CustomerProfile,
    availableSIP: number
  ): { totalSIP: number; allocations: Map<string, number> } {
    const allocations = new Map<string, number>();
    let totalSIP = 0;

    if (availableSIP <= 0) {
      return { totalSIP, allocations };
    }

    // Allocate remaining SIP proportionally to ambitious goals
    const ambitiousGoals = goals.filter((g) => {
      const basicState = this.goalStates.get(`${g.goalId}_basic`);
      return basicState && basicState.confidencePercent >= 90;
    });

    if (ambitiousGoals.length === 0) {
      return { totalSIP, allocations };
    }

    // Calculate weights based on ambitious tier priority
    const weights: number[] = ambitiousGoals.map((g) => 1 / g.tiers.ambitious.priority);
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);

    for (let i = 0; i < ambitiousGoals.length; i++) {
      const goal = ambitiousGoals[i];
      const weight = weights[i] / totalWeight;
      const allocatedSIP = availableSIP * weight;

      const goalCorpusAllocation = optimizedCorpus[goal.goalId] || {};
      const goalCorpus = Object.values(goalCorpusAllocation).reduce(
        (sum: number, v: number) => sum + v,
        0
      );
      const target = getGoalTarget(goal, "ambitious");

      // Get optimal asset allocation (no time-based shift for ambitious)
      const assetAllocation = getOptimalAllocation(
        goal,
        "ambitious",
        customerProfile.corpus.allowedAssetClasses,
        assetClasses
      );

      // Build asset class data map
      const assetClassDataMap: Record<string, any> = {};
      const timeHorizon = goal.horizonYears <= 3 ? "3Y" : goal.horizonYears <= 5 ? "5Y" : "10Y";

      for (const alloc of assetAllocation) {
        const data = getAssetClassData(assetClasses, alloc.assetClass, timeHorizon);
        if (data) {
          assetClassDataMap[alloc.assetClass] = data;
        }
      }

      allocations.set(goal.goalId, allocatedSIP);
      totalSIP += allocatedSIP;

      // Store state
      const envelopeBounds = calculatePortfolioEnvelopeBounds(
        goalCorpus,
        allocatedSIP,
        assetAllocation,
        assetClassDataMap,
        goal.horizonYears,
        this.context.sipInput.annualStepUpPercent
      );

      const confidencePercent = calculateConfidencePercent(target, envelopeBounds);

      this.goalStates.set(`${goal.goalId}_ambitious`, {
        goalId: goal.goalId,
        tier: "ambitious",
        allocatedCorpus: goalCorpus,
        allocatedSIP,
        assetAllocation,
        envelopeBounds,
        confidencePercent,
      });
    }

    return { totalSIP, allocations };
  }

  /**
   * Build SIP plan
   */
  private buildSIPPlan(
    basicSIP: { totalSIP: number; allocations: Map<string, number> },
    ambitiousSIP: { totalSIP: number; allocations: Map<string, number> },
    availableSIP: number
  ): SIPPlan {
    const perGoalAllocations: Array<{ goalId: string; monthlyAmount: number; percentage: number }> = [];
    const assetClassTotals: Record<string, number> = {};
    const plannedAllocations: Array<{
      goalId: string;
      tier: "basic" | "ambitious";
      amount: number;
      state: GoalPlanningState;
    }> = [];

    // Process basic tier allocations
    for (const [goalId, amount] of basicSIP.allocations.entries()) {
      const state = this.goalStates.get(`${goalId}_basic`);
      if (state) {
        plannedAllocations.push({
          goalId,
          tier: "basic",
          amount,
          state,
        });
      }
    }

    // Process ambitious tier allocations
    for (const [goalId, amount] of ambitiousSIP.allocations.entries()) {
      const state = this.goalStates.get(`${goalId}_ambitious`);
      if (state) {
        plannedAllocations.push({
          goalId,
          tier: "ambitious",
          amount,
          state,
        });
      }
    }

    const roundedAmounts = plannedAllocations.map((plan) => roundToNearest1000(plan.amount));
    let totalRounded = roundedAmounts.reduce((sum, amount) => sum + amount, 0);

    if (availableSIP > 0 && totalRounded > availableSIP) {
      const sortedIndexes = roundedAmounts
        .map((amount, index) => ({ amount, index }))
        .sort((a, b) => b.amount - a.amount)
        .map((entry) => entry.index);

      let remainingOver = totalRounded - availableSIP;

      while (remainingOver > 0) {
        let adjusted = false;
        for (const index of sortedIndexes) {
          if (roundedAmounts[index] >= 1000) {
            roundedAmounts[index] -= 1000;
            remainingOver -= 1000;
            totalRounded -= 1000;
            adjusted = true;
            if (remainingOver <= 0) {
              break;
            }
          }
        }

        if (!adjusted) {
          break;
        }
      }
    }

    for (let i = 0; i < plannedAllocations.length; i++) {
      const plan = plannedAllocations[i];
      const adjustedAmount = Math.max(0, roundedAmounts[i]);
      const percentage = availableSIP > 0
        ? Math.round((adjustedAmount / availableSIP) * 100)
        : 0;

      perGoalAllocations.push({
        goalId: `${plan.goalId}_${plan.tier}`,
        monthlyAmount: adjustedAmount,
        percentage,
      });

      for (const alloc of plan.state.assetAllocation) {
        assetClassTotals[alloc.assetClass] =
          (assetClassTotals[alloc.assetClass] || 0) + adjustedAmount * (alloc.percentage / 100);
      }
    }

    // Convert asset class totals to percentages (round totals to nearest 1000 first)
    const perAssetClassAllocations: SIPAssetAllocation[] = Object.entries(assetClassTotals).map(
      ([assetClass, total]) => {
        const roundedTotal = roundToNearest1000(total);
        return {
          assetClass,
          percentage: availableSIP > 0 ? Math.round((roundedTotal / availableSIP) * 100) : 0,
        };
      }
    );

    // Build goal asset allocations
    const goalAssetAllocations = Array.from(this.goalStates.entries()).map(([key, state]) => ({
      goalId: key,
      allocations: state.assetAllocation.map((a) => ({
        assetClass: a.assetClass,
        percentage: Math.round(a.percentage),
      })),
    }));

    return {
      totalMonthlySIP: availableSIP,
      perGoalAllocations,
      perAssetClassAllocations,
      goalAssetAllocations,
    };
  }

  /**
   * Build feasibility table
   */
  private buildFeasibilityTable(goals: Goal[]): GoalFeasibilityTable {
    const rows: GoalFeasibilityRow[] = [];

    for (const goal of goals) {
      // Basic tier
      const basicState = this.goalStates.get(`${goal.goalId}_basic`);
      if (basicState) {
        const targetAmount = getGoalTarget(goal, "basic");
        const { lower, mean } = basicState.envelopeBounds;
        
        // Round confidence before passing to getGoalStatus to match what's displayed
        const roundedConfidence = Math.round(basicState.confidencePercent);
        // For basic tier, ensure lower >= target for "can_be_met" status
        // Use rounded confidence to match test expectations
        const status = getGoalStatus(roundedConfidence, lower, targetAmount);
        
        rows.push({
          goalId: goal.goalId,
          goalName: goal.goalName,
          tier: "basic",
          status,
          confidencePercent: roundedConfidence,
          targetAmount: Math.round(targetAmount),
          projectedCorpus: {
            lower: Math.round(lower),
            mean: Math.round(mean),
            lowerDeviation: Math.round(lower - targetAmount),
            meanDeviation: Math.round(mean - targetAmount),
          },
        });
      }

      // Ambitious tier
      const ambitiousState = this.goalStates.get(`${goal.goalId}_ambitious`);
      if (ambitiousState) {
        const targetAmount = getGoalTarget(goal, "ambitious");
        const { lower, mean } = ambitiousState.envelopeBounds;
        
        // For ambitious tier, no strict requirement for lower >= target
        const status = getGoalStatus(ambitiousState.confidencePercent);
        
        rows.push({
          goalId: goal.goalId,
          goalName: goal.goalName,
          tier: "ambitious",
          status,
          confidencePercent: Math.round(ambitiousState.confidencePercent),
          targetAmount: Math.round(targetAmount),
          projectedCorpus: {
            lower: Math.round(lower),
            mean: Math.round(mean),
            lowerDeviation: Math.round(lower - targetAmount),
            meanDeviation: Math.round(mean - targetAmount),
          },
        });
      }
    }

    return { rows };
  }

  /**
   * Build allocation schedule
   */
  private buildAllocationSchedule(
    goals: Goal[],
    sipPlan: SIPPlan,
    sipInput: SIPInput,
    assetClasses: AssetClasses,
    customerProfile: CustomerProfile
  ): SIPAllocationSchedule {
    const snapshots: SIPAllocationSnapshot[] = [];
    const maxMonths = goals.length > 0
      ? Math.max(...goals.map((g) => yearsToMonths(g.horizonYears)))
      : 0;

    // Initial snapshot
    const initialPerGoal: Record<string, number> = {};
    const initialPerAssetClass: Record<string, number> = {};

    for (const alloc of sipPlan.perGoalAllocations) {
      initialPerGoal[alloc.goalId] = Math.round(alloc.percentage);
    }

    for (const alloc of sipPlan.perAssetClassAllocations) {
      initialPerAssetClass[alloc.assetClass] = Math.round(alloc.percentage);
    }

    snapshots.push(createInitialSnapshot(initialPerGoal, initialPerAssetClass));

    // Generate monthly snapshots (simplified: quarterly for performance)
    let currentSIP = sipInput.monthlySIP;
    for (let month = 3; month <= maxMonths; month += 3) {
      const year = Math.floor(month / 12);
      const monthInYear = month % 12;

      // Apply step-up annually
      if (monthInYear === 0 && year > 0) {
        currentSIP *= 1 + sipInput.annualStepUpPercent / 100;
      }

      // Recalculate allocations (simplified - in production, track goal completions)
      const snapshot: SIPAllocationSnapshot = {
        month,
        perGoalAllocations: { ...initialPerGoal },
        perAssetClassAllocations: { ...initialPerAssetClass },
        changeReason: monthInYear === 0 ? "step_up" : undefined,
      };

      snapshots.push(snapshot);
    }

    return { snapshots };
  }


  /**
   * Plan basic tier goals using Monte Carlo
   */
  private planBasicTiersMonteCarlo(
    goals: Goal[],
    optimizedCorpus: Record<string, Record<string, number>>,
    assetClasses: AssetClasses,
    customerProfile: CustomerProfile,
    availableSIP: number,
    monteCarloPaths: number
  ): { totalSIP: number; allocations: Map<string, number> } {
    const requiredSIPs = new Map<string, number>();
    const goalData = new Map<string, {
      goal: Goal;
      corpusByAssetClass: Record<string, number>;
      assetAllocation: AssetAllocation[];
      assetClassDataMap: Record<string, AssetClassData>;
    }>();

    // Step 1: Calculate required SIP for each goal using Monte Carlo
    for (const goal of goals) {
      const goalCorpusAllocation = optimizedCorpus[goal.goalId] || {};
      const target = getGoalTarget(goal, "basic");

      // Get optimal asset allocation
      const assetAllocation = getOptimalAllocation(
        goal,
        "basic",
        customerProfile.corpus.allowedAssetClasses,
        assetClasses
      );

      // Build asset class data map
      const assetClassDataMap: Record<string, AssetClassData> = {};
      const timeHorizon = goal.horizonYears <= 3 ? "3Y" : goal.horizonYears <= 5 ? "5Y" : "10Y";

      for (const alloc of assetAllocation) {
        const data = getAssetClassData(assetClasses, alloc.assetClass, timeHorizon);
        if (data) {
          assetClassDataMap[alloc.assetClass] = data;
        }
      }

      // Calculate required SIP using Monte Carlo
      const requiredSIP = calculateRequiredSIPMonteCarlo(
        target,
        goalCorpusAllocation,
        assetAllocation,
        assetClassDataMap,
        goal.horizonYears,
        monteCarloPaths,
        50, // maxIterations
        this.context.sipInput.annualStepUpPercent
      );

      requiredSIPs.set(goal.goalId, requiredSIP);
      goalData.set(goal.goalId, {
        goal,
        corpusByAssetClass: goalCorpusAllocation,
        assetAllocation,
        assetClassDataMap,
      });
    }

    // Step 2: Calculate total required SIP
    const totalRequiredSIP = Array.from(requiredSIPs.values()).reduce((sum, sip) => sum + sip, 0);

    // Step 3: Allocate SIP - prioritize ensuring lower >= target for basic tier goals
    const allocations = new Map<string, number>();
    let remainingSIP = availableSIP;

    if (totalRequiredSIP <= availableSIP) {
      // Enough SIP available, use required amounts
      for (const [goalId, requiredSIP] of requiredSIPs.entries()) {
        allocations.set(goalId, requiredSIP);
        remainingSIP -= requiredSIP;
      }
    } else {
      // Not enough SIP - allocate based on priority to maximize "can_be_met" goals
      const goalIds = Array.from(requiredSIPs.keys()); // Goals are already in priority order
      
      // First pass: Allocate full required SIP to goals we can fully fund
      for (const goalId of goalIds) {
        const requiredSIP = requiredSIPs.get(goalId)!;
        if (remainingSIP >= requiredSIP) {
          allocations.set(goalId, requiredSIP);
          remainingSIP -= requiredSIP;
        } else {
          // Not enough for this goal, allocate what we can
          if (remainingSIP > 0) {
            allocations.set(goalId, remainingSIP);
            remainingSIP = 0;
          } else {
            allocations.set(goalId, 0);
          }
        }
      }
    }

    // Step 4: Store state for each goal with allocated SIP
    for (const [goalId, allocatedSIP] of allocations.entries()) {
      const data = goalData.get(goalId);
      if (!data) continue;

      // Calculate SIP allocation by asset class
      const monthlySIPByAssetClass: Record<string, number> = {};
      for (const alloc of data.assetAllocation) {
        if (alloc.assetClass === "cash") continue;
        monthlySIPByAssetClass[alloc.assetClass] = (allocatedSIP * alloc.percentage) / 100;
      }

      // Run Monte Carlo to get bounds
      const paths = runPortfolioMonteCarloSimulationLognormal(
        data.corpusByAssetClass,
        monthlySIPByAssetClass,
        data.assetAllocation,
        data.assetClassDataMap,
        data.goal.horizonYears,
        monteCarloPaths,
        this.context.sipInput.annualStepUpPercent
      );

      const bounds = calculateMonteCarloBounds(paths);
      const target = getGoalTarget(data.goal, "basic");
      const confidencePercent = Math.round(calculateMonteCarloConfidence(paths, target));

      this.goalStates.set(`${goalId}_basic`, {
        goalId,
        tier: "basic",
        allocatedCorpus: Object.values(data.corpusByAssetClass).reduce((sum, v) => sum + v, 0),
        allocatedSIP,
        assetAllocation: data.assetAllocation,
        envelopeBounds: bounds,
        confidencePercent,
      });
    }

    const totalSIP = Array.from(allocations.values()).reduce((sum, sip) => sum + sip, 0);
    return { totalSIP, allocations };
  }

  /**
   * Plan ambitious tier goals using Monte Carlo
   */
  private planAmbitiousTiersMonteCarlo(
    goals: Goal[],
    optimizedCorpus: Record<string, Record<string, number>>,
    assetClasses: AssetClasses,
    customerProfile: CustomerProfile,
    availableSIP: number,
    monteCarloPaths: number
  ): { totalSIP: number; allocations: Map<string, number> } {
    const allocations = new Map<string, number>();
    let totalSIP = 0;

    if (availableSIP <= 0) {
      return { totalSIP, allocations };
    }

    // Allocate remaining SIP proportionally to ambitious goals
    const ambitiousGoals = goals.filter((g) => {
      const basicState = this.goalStates.get(`${g.goalId}_basic`);
      return basicState && basicState.confidencePercent >= 90;
    });

    if (ambitiousGoals.length === 0) {
      return { totalSIP, allocations };
    }

    // Calculate weights based on ambitious tier priority
    const weights: number[] = ambitiousGoals.map((g) => 1 / g.tiers.ambitious.priority);
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);

    for (let i = 0; i < ambitiousGoals.length; i++) {
      const goal = ambitiousGoals[i];
      const weight = weights[i] / totalWeight;
      const allocatedSIP = availableSIP * weight;

      const goalCorpusAllocation = optimizedCorpus[goal.goalId] || {};
      const target = getGoalTarget(goal, "ambitious");

      // Get optimal asset allocation (no time-based shift for ambitious)
      const assetAllocation = getOptimalAllocation(
        goal,
        "ambitious",
        customerProfile.corpus.allowedAssetClasses,
        assetClasses
      );

      // Build asset class data map
      const assetClassDataMap: Record<string, AssetClassData> = {};
      const timeHorizon = goal.horizonYears <= 3 ? "3Y" : goal.horizonYears <= 5 ? "5Y" : "10Y";

      for (const alloc of assetAllocation) {
        const data = getAssetClassData(assetClasses, alloc.assetClass, timeHorizon);
        if (data) {
          assetClassDataMap[alloc.assetClass] = data;
        }
      }

      allocations.set(goal.goalId, allocatedSIP);
      totalSIP += allocatedSIP;

      // Calculate SIP allocation by asset class
      const monthlySIPByAssetClass: Record<string, number> = {};
      for (const alloc of assetAllocation) {
        if (alloc.assetClass === "cash") continue;
        monthlySIPByAssetClass[alloc.assetClass] = (allocatedSIP * alloc.percentage) / 100;
      }

      // Run Monte Carlo to get bounds
      const paths = runPortfolioMonteCarloSimulationLognormal(
        goalCorpusAllocation,
        monthlySIPByAssetClass,
        assetAllocation,
        assetClassDataMap,
        goal.horizonYears,
        monteCarloPaths,
        this.context.sipInput.annualStepUpPercent
      );

      const bounds = calculateMonteCarloBounds(paths);
      const confidencePercent = Math.round(calculateMonteCarloConfidence(paths, target));

      this.goalStates.set(`${goal.goalId}_ambitious`, {
        goalId: goal.goalId,
        tier: "ambitious",
        allocatedCorpus: Object.values(goalCorpusAllocation).reduce((sum, v) => sum + v, 0),
        allocatedSIP,
        assetAllocation,
        envelopeBounds: bounds,
        confidencePercent,
      });
    }

    return { totalSIP, allocations };
  }

  /**
   * Build feasibility table using Monte Carlo
   */
  private buildFeasibilityTableMonteCarlo(
    goals: Goal[],
    monteCarloPaths: number
  ): GoalFeasibilityTable {
    const rows: GoalFeasibilityRow[] = [];

    for (const goal of goals) {
      // Basic tier
      const basicState = this.goalStates.get(`${goal.goalId}_basic`);
      if (basicState) {
        const target = getGoalTarget(goal, "basic");
        const { lower, mean } = basicState.envelopeBounds;
        const lowerDeviation = lower - target;
        const meanDeviation = mean - target;
        const status = getGoalStatus(basicState.confidencePercent, lower, target);

        rows.push({
          goalId: goal.goalId,
          goalName: goal.goalName,
          tier: "basic",
          status,
          confidencePercent: Math.round(basicState.confidencePercent),
          targetAmount: Math.round(target),
          projectedCorpus: {
            lower: Math.round(lower),
            mean: Math.round(mean),
            lowerDeviation: Math.round(lowerDeviation),
            meanDeviation: Math.round(meanDeviation),
          },
        });
      }

      // Ambitious tier
      const ambitiousState = this.goalStates.get(`${goal.goalId}_ambitious`);
      if (ambitiousState) {
        const target = getGoalTarget(goal, "ambitious");
        const { lower, mean } = ambitiousState.envelopeBounds;
        const lowerDeviation = lower - target;
        const meanDeviation = mean - target;
        const status = getGoalStatus(ambitiousState.confidencePercent, lower, target);

        rows.push({
          goalId: goal.goalId,
          goalName: goal.goalName,
          tier: "ambitious",
          status,
          confidencePercent: Math.round(ambitiousState.confidencePercent),
          targetAmount: Math.round(target),
          projectedCorpus: {
            lower: Math.round(lower),
            mean: Math.round(mean),
            lowerDeviation: Math.round(lowerDeviation),
            meanDeviation: Math.round(meanDeviation),
          },
        });
      }
    }

    return { rows };
  }

  /**
   * Build feasibility table based on total portfolio networth
   * A goal is "can_be_met" if total portfolio networth can cover all withdrawals,
   * even if that goal's own resources are insufficient.
   */
  private buildFeasibilityTableFromPortfolio(
    planningResult: PlanningResult,
    goals: Goal[],
    method: "method1" | "method2" | "method3",
    monteCarloPaths?: number
  ): GoalFeasibilityTable {
    const rows: GoalFeasibilityRow[] = [];
    const { assetClasses, customerProfile, sipInput } = this.context;

    // Sort goals by due date (earliest first) to account for withdrawal order
    const sortedGoals = [...goals].sort((a, b) => a.horizonYears - b.horizonYears);

    // For each goal and tier, calculate portfolio-based feasibility
    for (const goal of sortedGoals) {
      // Basic tier
      const basicState = this.goalStates.get(`${goal.goalId}_basic`);
      if (basicState) {
        const targetAmount = getGoalTarget(goal, "basic");
        const { lower: perGoalLower, mean: perGoalMean } = basicState.envelopeBounds;

        // Calculate portfolio networth projection for basic tier
        const portfolioProjection = calculateNetworthProjection(
          method,
          planningResult,
          goals,
          customerProfile,
          assetClasses,
          sipInput,
          "basic"
        );

        // Get goal due date month
        const goalDueMonth = yearsToMonths(goal.horizonYears);
        const monthData = portfolioProjection.monthlyValues.find(d => d.month === goalDueMonth);

        if (monthData) {
          const portfolioNetworth = monthData.totalNetworth;
          const remainingNetworth = portfolioNetworth - targetAmount;

          // Calculate portfolio bounds (for Methods 1 & 3, we need lower bound)
          let portfolioLower = portfolioNetworth;
          let portfolioMean = portfolioNetworth;
          let confidencePercent = 0;
          let status: GoalStatus = "cannot_be_met";

          if (monteCarloPaths) {
            // Use portfolio-level Monte Carlo for confidence (all methods)
            // For single-goal scenarios, use per-goal confidence (more accurate)
            if (goals.length === 1) {
              confidencePercent = basicState.confidencePercent;
              portfolioMean = portfolioNetworth;
              portfolioLower = perGoalLower;
            } else {
              // For multi-goal scenarios, calculate portfolio confidence
              const confidence = this.calculatePortfolioConfidenceMonteCarlo(
                planningResult,
                goals,
                goal,
                "basic",
                goalDueMonth,
                targetAmount,
                monteCarloPaths
              );
              confidencePercent = confidence;
              portfolioMean = portfolioNetworth;
              portfolioLower = portfolioNetworth * 0.9; // Approximate lower bound
            }
          } else {
            // Fallback: envelope-based lower bound (when monteCarloPaths not provided)
            const portfolioLowerBound = this.calculatePortfolioLowerBound(
              planningResult,
              goals,
              goal,
              "basic",
              goalDueMonth
            );
            portfolioLower = portfolioLowerBound;
            portfolioMean = portfolioNetworth;

            // Calculate confidence based on lower bound remaining networth
            const remainingLower = portfolioLowerBound - targetAmount;
            confidencePercent = this.calculateConfidenceFromRemaining(remainingLower, targetAmount);
          }

          // Determine status based on confidence (use rounded value for consistency with display)
          const roundedConfidence = Math.round(confidencePercent);
          if (roundedConfidence >= 90) {
            status = "can_be_met";
          } else if (roundedConfidence >= 50) {
            status = "at_risk";
          } else {
            status = "cannot_be_met";
          }

          rows.push({
            goalId: goal.goalId,
            goalName: goal.goalName,
            tier: "basic",
            status,
            confidencePercent: roundedConfidence,
            targetAmount: Math.round(targetAmount),
            projectedCorpus: {
              lower: Math.round(perGoalLower),
              mean: Math.round(perGoalMean),
              lowerDeviation: Math.round(perGoalLower - targetAmount),
              meanDeviation: Math.round(perGoalMean - targetAmount),
            },
            portfolioProjectedCorpus: {
              lower: Math.round(portfolioLower),
              mean: Math.round(portfolioMean),
            },
          });
        }
      }

      // Ambitious tier
      const ambitiousState = this.goalStates.get(`${goal.goalId}_ambitious`);
      if (ambitiousState) {
        const targetAmount = getGoalTarget(goal, "ambitious");
        const { lower: perGoalLower, mean: perGoalMean } = ambitiousState.envelopeBounds;

        // Calculate portfolio networth projection for ambitious tier
        const portfolioProjection = calculateNetworthProjection(
          method,
          planningResult,
          goals,
          customerProfile,
          assetClasses,
          sipInput,
          "ambitious"
        );

        // Get goal due date month
        const goalDueMonth = yearsToMonths(goal.horizonYears);
        const monthData = portfolioProjection.monthlyValues.find(d => d.month === goalDueMonth);

        if (monthData) {
          const portfolioNetworth = monthData.totalNetworth;
          const remainingNetworth = portfolioNetworth - targetAmount;

          // Calculate portfolio bounds
          let portfolioLower = portfolioNetworth;
          let portfolioMean = portfolioNetworth;
          let confidencePercent = 0;
          let status: GoalStatus = "cannot_be_met";

          if (monteCarloPaths) {
            // Use portfolio-level Monte Carlo for confidence (all methods)
            // For single-goal scenarios, use per-goal confidence (more accurate)
            if (goals.length === 1) {
              confidencePercent = ambitiousState.confidencePercent;
              portfolioMean = portfolioNetworth;
              portfolioLower = perGoalLower;
            } else {
              // For multi-goal scenarios, calculate portfolio confidence
              const confidence = this.calculatePortfolioConfidenceMonteCarlo(
                planningResult,
                goals,
                goal,
                "ambitious",
                goalDueMonth,
                targetAmount,
                monteCarloPaths
              );
              confidencePercent = confidence;
              portfolioMean = portfolioNetworth;
              portfolioLower = portfolioNetworth * 0.9;
            }
          } else {
            // Fallback: envelope-based lower bound (when monteCarloPaths not provided)
            const portfolioLowerBound = this.calculatePortfolioLowerBound(
              planningResult,
              goals,
              goal,
              "ambitious",
              goalDueMonth
            );
            portfolioLower = portfolioLowerBound;
            portfolioMean = portfolioNetworth;

            const remainingLower = portfolioLowerBound - targetAmount;
            confidencePercent = this.calculateConfidenceFromRemaining(remainingLower, targetAmount);
          }

          // Determine status based on confidence (use rounded value for consistency with display)
          const roundedConfidence = Math.round(confidencePercent);
          if (roundedConfidence >= 90) {
            status = "can_be_met";
          } else if (roundedConfidence >= 50) {
            status = "at_risk";
          } else {
            status = "cannot_be_met";
          }

          rows.push({
            goalId: goal.goalId,
            goalName: goal.goalName,
            tier: "ambitious",
            status,
            confidencePercent: roundedConfidence,
            targetAmount: Math.round(targetAmount),
            projectedCorpus: {
              lower: Math.round(perGoalLower),
              mean: Math.round(perGoalMean),
              lowerDeviation: Math.round(perGoalLower - targetAmount),
              meanDeviation: Math.round(perGoalMean - targetAmount),
            },
            portfolioProjectedCorpus: {
              lower: Math.round(portfolioLower),
              mean: Math.round(portfolioMean),
            },
          });
        }
      }
    }

    return { rows };
  }

  /**
   * Calculate confidence from remaining networth (for Methods 1 & 3)
   */
  private calculateConfidenceFromRemaining(remainingLower: number, targetAmount: number): number {
    // Option A - Zero Threshold logic
    if (remainingLower >= 0) {
      // Calculate confidence based on buffer (90-100%)
      // If remaining >= 10% of target, 100% confidence
      // Otherwise interpolate from 90% to 100%
      const bufferPercent = (remainingLower / targetAmount) * 100;
      if (bufferPercent >= 10) {
        return 100;
      }
      // Interpolate from 90% (at 0 buffer) to 100% (at 10% buffer)
      return 90 + (bufferPercent / 10) * 10;
    } else if (remainingLower >= -targetAmount * 0.1) {
      // At risk: interpolate from 50% to 0%
      // At remainingLower = 0: 50%
      // At remainingLower = -10% of target: 0%
      const shortfallPercent = Math.abs(remainingLower / targetAmount) * 100;
      return 50 - (shortfallPercent / 10) * 50;
    } else {
      // Cannot be met
      return 0;
    }
  }

  /**
   * Calculate portfolio lower bound at goal due date (for Methods 1 & 3)
   * For single-goal scenarios, use the per-goal lower bound
   * For multi-goal scenarios, calculate using envelope method for the portfolio
   */
  private calculatePortfolioLowerBound(
    planningResult: PlanningResult,
    goals: Goal[],
    targetGoal: Goal,
    tier: "basic" | "ambitious",
    goalDueMonth: number
  ): number {
    // For single-goal scenarios, use the per-goal lower bound (more accurate)
    if (goals.length === 1) {
      const goalState = this.goalStates.get(`${targetGoal.goalId}_${tier}`);
      if (goalState) {
        return goalState.envelopeBounds.lower;
      }
    }

    // For multi-goal scenarios, calculate portfolio lower bound
    // Use the per-goal lower bound of the target goal as a proxy
    // In a full implementation, we'd calculate the actual portfolio lower bound
    // using envelope method considering all goals together
    const goalState = this.goalStates.get(`${targetGoal.goalId}_${tier}`);
    if (goalState) {
      // Use per-goal lower bound as approximation
      // This works well when goals are independent or when the target goal
      // is the primary contributor to portfolio networth
      return goalState.envelopeBounds.lower;
    }

    // Fallback: use 90% of mean from portfolio projection
    const portfolioProjection = calculateNetworthProjection(
      "method1",
      planningResult,
      goals,
      this.context.customerProfile,
      this.context.assetClasses,
      this.context.sipInput,
      tier
    );

    const monthData = portfolioProjection.monthlyValues.find(d => d.month === goalDueMonth);
    if (monthData) {
      return monthData.totalNetworth * 0.9;
    }

    return 0;
  }

  /**
   * Calculate portfolio confidence using Monte Carlo lite (for Method 2 multi-goal)
   * Runs 75 stochastic paths to simulate portfolio and counts paths where
   * networth at goal due date >= target amount.
   */
  private calculatePortfolioConfidenceMonteCarlo(
    planningResult: PlanningResult,
    goals: Goal[],
    targetGoal: Goal,
    tier: "basic" | "ambitious",
    goalDueMonth: number,
    targetAmount: number,
    _monteCarloPaths: number
  ): number {
    const networthAtDueMonth = runMultiGoalPortfolioMonteCarloLite(
      planningResult,
      goals,
      targetGoal,
      this.context.customerProfile,
      this.context.assetClasses,
      { annualStepUpPercent: this.context.sipInput.annualStepUpPercent },
      tier,
      goalDueMonth
    );
    return calculateConfidenceFromPaths(networthAtDueMonth, targetAmount);
  }
}
