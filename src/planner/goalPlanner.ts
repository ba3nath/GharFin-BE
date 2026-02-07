import { CustomerProfile, getTotalCorpus } from "../models/CustomerProfile";
import { Goal, getBasicTiersSorted, getGoalTarget } from "../models/Goal";
import { AssetClasses, getAssetClassData, AssetClassData } from "../models/AssetClass";
import {
  calculatePortfolioEnvelopeBounds,
  calculateConfidencePercent,
  calculateRequiredSIP,
  calculatePresentValueOfTarget,
  calculateMinimumSIPForConfidenceEnvelope,
  calculateMinimumCorpusForConfidenceEnvelope,
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
  SIP_TOLERANCE,
  DEFAULT_MAX_ITERATIONS,
  SHORT_TERM_HORIZON_YEARS,
  CONFIDENCE_CAN_BE_MET,
  CONFIDENCE_AT_RISK_MIN,
  CORPUS_RECLAIM_TARGET_CONFIDENCE,
} from "../utils/constants";
import {
  optimizeCorpusAllocation,
} from "../engine/rebalancer";
import {
  runPortfolioMonteCarloSimulationLognormal,
  calculateMonteCarloBounds,
  calculateMonteCarloConfidence,
  calculateRequiredSIPMonteCarlo,
  calculateMinimumSIPForConfidenceMonteCarlo,
  calculateMinimumCorpusForConfidenceMonteCarlo,
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
  planMethod1(maxIterations: number = DEFAULT_MAX_ITERATIONS, monteCarloPaths: number = SIMULATION_COUNT_LITE): Method1Result {
    this.goalStates.clear();
    const { assetClasses, customerProfile, goals, sipInput } = this.context;

    // Sort goals by basic tier priority
    const sortedGoals = getBasicTiersSorted(goals);

    // Separate goals by horizon (< 3 years = short-term, SIP = 0; >= 3 years = long-term)
    const shortTermGoals = sortedGoals.filter((g) => g.horizonYears < SHORT_TERM_HORIZON_YEARS);
    const longTermGoals = sortedGoals.filter((g) => g.horizonYears >= SHORT_TERM_HORIZON_YEARS);

    const shortTermCorpusAllocation = this.handleShortTermGoals(
      shortTermGoals,
      assetClasses,
      customerProfile,
      { useEnvelope: true }
    );

    // Calculate available SIP (base + stretch) for long-term goals only
    const availableSIP = sipInput.monthlySIP * (1 + sipInput.stretchSIPPercent / 100);

    // Start with initial corpus allocation for long-term goals only
    let optimizedCorpus = this.optimizeCorpusAllocation(longTermGoals);

    // Iterate until convergence (only for long-term goals)
    const sipTolerance = SIP_TOLERANCE;
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

    // Reclaim surplus SIP from basic tiers where confidence > 90%
    const { reclaimedAllocations } = this.reclaimSurplusSIPFromBasicTiers(
      longTermGoals,
      optimizedCorpus,
      assetClasses,
      customerProfile,
      finalBasicGoalSIP.allocations,
      "method1",
      monteCarloPaths
    );
    const reclaimedTotalSIP = Array.from(reclaimedAllocations.values()).reduce((sum, sip) => sum + sip, 0);
    finalBasicGoalSIP = { totalSIP: reclaimedTotalSIP, allocations: reclaimedAllocations };

    // Reclaim surplus corpus from basic tiers where confidence > 90%
    optimizedCorpus = this.reclaimSurplusCorpusFromBasicTiers(
      longTermGoals,
      optimizedCorpus,
      reclaimedAllocations,
      assetClasses,
      customerProfile,
      "method1",
      monteCarloPaths
    );
    const mergedCorpusWithReclaim: Record<string, Record<string, number>> = {
      ...optimizedCorpus,
      ...shortTermCorpusAllocation,
    };

    // Phase 2: Allocate remaining SIP to ambitious tiers (long-term goals only)
    const remainingSIP = Math.max(0, availableSIP - finalBasicGoalSIP.totalSIP);
    const ambitiousGoalSIP = this.planAmbitiousTiers(
      longTermGoals,
      optimizedCorpus,
      assetClasses,
      customerProfile,
      remainingSIP
    );

    // Build SIP plan and allocation schedule once
    const sipPlan = this.buildSIPPlan(finalBasicGoalSIP, ambitiousGoalSIP, availableSIP);
    const allocationSchedule = this.buildAllocationSchedule(
      sortedGoals,
      sipPlan,
      sipInput,
      assetClasses,
      customerProfile
    );

    // Build planning result for portfolio-based feasibility calculation
    const planningResult: Method1Result = {
      method: "method1",
      goalFeasibilityTable: this.buildFeasibilityTable(sortedGoals), // Keep for per-goal bounds
      sipAllocation: sipPlan,
      sipAllocationSchedule: allocationSchedule,
      corpusAllocation: mergedCorpusWithReclaim,
    };

    // Build feasibility table based on total portfolio networth
    const feasibilityTable = this.buildFeasibilityTableFromPortfolio(
      planningResult,
      sortedGoals,
      "method1",
      monteCarloPaths
    );

    // Get corpus allocation for each goal (merged short-term + long-term)
    const corpusAllocation: Record<string, Record<string, number>> = {};
    for (const goal of sortedGoals) {
      const goalCorpusAlloc = mergedCorpusWithReclaim[goal.goalId] || {};
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
  planMethod2(monteCarloPaths: number = 1000, maxIterations: number = DEFAULT_MAX_ITERATIONS): Method2Result {
    this.goalStates.clear();
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
    const shortTermGoals = sortedGoals.filter((g) => g.horizonYears < SHORT_TERM_HORIZON_YEARS);
    const longTermGoals = sortedGoals.filter((g) => g.horizonYears >= SHORT_TERM_HORIZON_YEARS);

    const shortTermCorpusAllocation = this.handleShortTermGoals(
      shortTermGoals,
      assetClasses,
      customerProfile,
      { useEnvelope: false, monteCarloPaths }
    );

    // Calculate available SIP (base + stretch) for long-term goals only
    const availableSIP = sipInput.monthlySIP * (1 + sipInput.stretchSIPPercent / 100);

    // Start with initial corpus allocation for long-term goals only
    let optimizedCorpus = this.optimizeCorpusAllocation(longTermGoals);

    // Iterate until convergence (only for long-term goals)
    const sipTolerance = SIP_TOLERANCE;
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

    // Reclaim surplus SIP from basic tiers where confidence > 90%
    const { reclaimedAllocations } = this.reclaimSurplusSIPFromBasicTiers(
      longTermGoals,
      optimizedCorpus,
      assetClasses,
      customerProfile,
      finalBasicGoalSIP.allocations,
      "method2",
      monteCarloPaths
    );
    const reclaimedTotalSIP = Array.from(reclaimedAllocations.values()).reduce((sum, sip) => sum + sip, 0);
    finalBasicGoalSIP = { totalSIP: reclaimedTotalSIP, allocations: reclaimedAllocations };

    // Reclaim surplus corpus from basic tiers where confidence > 90%
    optimizedCorpus = this.reclaimSurplusCorpusFromBasicTiers(
      longTermGoals,
      optimizedCorpus,
      reclaimedAllocations,
      assetClasses,
      customerProfile,
      "method2",
      monteCarloPaths
    );
    const mergedCorpusMethod2: Record<string, Record<string, number>> = {
      ...optimizedCorpus,
      ...shortTermCorpusAllocation,
    };

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
      const goalCorpusAlloc = mergedCorpusMethod2[goal.goalId];
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
      corpusAllocation: mergedCorpusMethod2,
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
  planMethod3(monteCarloPaths: number = 1000, maxIterations: number = DEFAULT_MAX_ITERATIONS): Method3Result {
    this.goalStates.clear();
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
    const longTermGoals = sortedGoals.filter((g) => g.horizonYears >= SHORT_TERM_HORIZON_YEARS);
    const shortTermGoals = sortedGoals.filter((g) => g.horizonYears < SHORT_TERM_HORIZON_YEARS);

    const shortTermCorpusAllocation = this.handleShortTermGoals(
      shortTermGoals,
      assetClasses,
      customerProfile,
      { useEnvelope: false, monteCarloPaths, redistributeByAllocation: true }
    );

    // Step 2: Handle long-term goals (>= 3 years) with iterative rebalancing
    let optimizedCorpus: Record<string, Record<string, number>> = {};
    const sipTolerance = SIP_TOLERANCE;

    if (longTermGoals.length > 0) {
      // Calculate available SIP (base + stretch)
      const availableSIP = sipInput.monthlySIP * (1 + sipInput.stretchSIPPercent / 100);

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

      // Reclaim surplus SIP from basic tiers where confidence > 90%
      const { reclaimedAllocations } = this.reclaimSurplusSIPFromBasicTiers(
        longTermGoals,
        optimizedCorpus,
        assetClasses,
        customerProfile,
        finalBasicGoalSIP.allocations,
        "method3",
        monteCarloPaths
      );
      const reclaimedTotalSIP = Array.from(reclaimedAllocations.values()).reduce((sum, sip) => sum + sip, 0);
      finalBasicGoalSIP = { totalSIP: reclaimedTotalSIP, allocations: reclaimedAllocations };

      // Reclaim surplus corpus from basic tiers where confidence > 90%
      optimizedCorpus = this.reclaimSurplusCorpusFromBasicTiers(
        longTermGoals,
        optimizedCorpus,
        reclaimedAllocations,
        assetClasses,
        customerProfile,
        "method3",
        monteCarloPaths
      );

      // Phase 2: Allocate remaining SIP to ambitious tiers
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
   * Optimizes corpus allocation across goals by calculating requirements using present value.
   * PV accounts for growth: goals with longer horizons need less corpus per rupee of target.
   *
   * @param goals - Goals to allocate corpus for
   * @returns Map of goal IDs to their corpus allocations by asset class
   */
  private optimizeCorpusAllocationForGoals(
    goals: Goal[]
  ): Record<string, Record<string, number>> {
    const goalRequirements = this.computePVBasedGoalRequirements(goals, getTotalCorpus(this.context.customerProfile));
    return optimizeCorpusAllocation(
      this.context.customerProfile,
      goals,
      goalRequirements
    );
  }

  /**
   * Computes corpus requirements per goal using present value of targets.
   * Allocation is proportional to PV so that growth is considered before allocating.
   */
  private computePVBasedGoalRequirements(
    goals: Goal[],
    totalCorpus: number
  ): Record<string, number> {
    return this.computePVBasedGoalRequirementsForProfile(
      goals,
      totalCorpus,
      this.context.customerProfile,
      this.context.assetClasses
    );
  }

  /**
   * Computes PV-based requirements with explicit profile and asset classes.
   */
  private computePVBasedGoalRequirementsForProfile(
    goals: Goal[],
    totalCorpus: number,
    customerProfile: CustomerProfile,
    assetClasses: AssetClasses
  ): Record<string, number> {
    const goalRequirements: Record<string, number> = {};

    if (goals.length === 1) {
      goalRequirements[goals[0].goalId] = totalCorpus;
      return goalRequirements;
    }

    const pvByGoal: Record<string, number> = {};
    for (const goal of goals) {
      const target = getGoalTarget(goal, "basic");
      const assetAllocation = getOptimalAllocation(
        goal,
        "basic",
        customerProfile.corpus.allowedAssetClasses,
        assetClasses,
        0
      );
      const timeHorizon = goal.horizonYears <= 3 ? "3Y" : goal.horizonYears <= 5 ? "5Y" : "10Y";
      const assetClassDataMap: Record<string, AssetClassData> = {};
      for (const alloc of assetAllocation) {
        const data = getAssetClassData(assetClasses, alloc.assetClass, timeHorizon);
        if (data) assetClassDataMap[alloc.assetClass] = data;
      }
      pvByGoal[goal.goalId] = calculatePresentValueOfTarget(
        target,
        assetAllocation,
        assetClassDataMap,
        goal.horizonYears
      );
    }

    const totalPV = Object.values(pvByGoal).reduce((sum, pv) => sum + pv, 0);
    for (const goal of goals) {
      const pv = pvByGoal[goal.goalId] ?? 0;
      goalRequirements[goal.goalId] = totalPV > 0 ? (pv / totalPV) * totalCorpus : 0;
    }

    return goalRequirements;
  }

  /**
   * Handle short-term goals (< 3 years): allocate corpus, set SIP to 0, store state.
   * Uses envelope for Method 1, Monte Carlo for Method 2 and 3.
   */
  private handleShortTermGoals(
    shortTermGoals: Goal[],
    assetClasses: AssetClasses,
    customerProfile: CustomerProfile,
    options: { useEnvelope: true } | { useEnvelope: false; monteCarloPaths: number; redistributeByAllocation?: boolean }
  ): Record<string, Record<string, number>> {
    const shortTermCorpusAllocation: Record<string, Record<string, number>> = {};
    if (shortTermGoals.length === 0) return shortTermCorpusAllocation;

    const totalCorpus = getTotalCorpus(customerProfile);
    const goalCorpusRequirements = this.computePVBasedGoalRequirementsForProfile(
      shortTermGoals,
      totalCorpus,
      customerProfile,
      assetClasses
    );
    const allocatedCorpus = optimizeCorpusAllocation(
      customerProfile,
      shortTermGoals,
      goalCorpusRequirements
    );

    for (const goal of shortTermGoals) {
      let goalCorpusAlloc = allocatedCorpus[goal.goalId] || {};
      const goalCorpusTotal = Object.values(goalCorpusAlloc).reduce((sum, v) => sum + v, 0);

      const assetAllocation = getOptimalAllocation(
        goal,
        "basic",
        customerProfile.corpus.allowedAssetClasses,
        assetClasses,
        0
      );

      if (options.useEnvelope === false && options.redistributeByAllocation) {
        const finalGoalCorpusAlloc: Record<string, number> = {};
        for (const alloc of assetAllocation) {
          if (alloc.assetClass === "cash") continue;
          finalGoalCorpusAlloc[alloc.assetClass] = goalCorpusTotal * (alloc.percentage / 100);
        }
        goalCorpusAlloc = finalGoalCorpusAlloc;
      }

      shortTermCorpusAllocation[goal.goalId] = goalCorpusAlloc;

      const assetClassDataMap: Record<string, AssetClassData> = {};
      const timeHorizon = goal.horizonYears <= 3 ? "3Y" : goal.horizonYears <= 5 ? "5Y" : "10Y";
      for (const alloc of assetAllocation) {
        const data = getAssetClassData(assetClasses, alloc.assetClass, timeHorizon);
        if (data) assetClassDataMap[alloc.assetClass] = data;
      }

      const target = getGoalTarget(goal, "basic");
      let envelopeBounds: { lower: number; mean: number };
      let confidencePercent: number;

      if (options.useEnvelope) {
        envelopeBounds = calculatePortfolioEnvelopeBounds(
          goalCorpusTotal,
          0,
          assetAllocation,
          assetClassDataMap,
          goal.horizonYears,
          0
        );
        confidencePercent = calculateConfidencePercent(target, envelopeBounds);
      } else {
        const monthlySIPByAssetClass: Record<string, number> = {};
        const paths = runPortfolioMonteCarloSimulationLognormal(
          goalCorpusAlloc,
          monthlySIPByAssetClass,
          assetAllocation,
          assetClassDataMap,
          goal.horizonYears,
          options.monteCarloPaths,
          0
        );
        envelopeBounds = calculateMonteCarloBounds(paths);
        confidencePercent = Math.round(calculateMonteCarloConfidence(paths, target));
      }

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

    return shortTermCorpusAllocation;
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
      // When no corpus left for long-term (e.g. short-term consumed all), return empty allocations
      const emptyAllocations: Record<string, Record<string, number>> = {};
      for (const goal of goals) {
        emptyAllocations[goal.goalId] = {};
      }
      return emptyAllocations;
    }

    // Allocate corpus proportionally using PV (considers growth before allocation)
    const goalCorpusRequirements = this.computePVBasedGoalRequirements(goals, availableCorpus);

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
   * Optimize corpus allocation across goals using PV-based requirements.
   */
  private optimizeCorpusAllocation(goals: Goal[]): Record<string, Record<string, number>> {
    const totalCorpus = getTotalCorpus(this.context.customerProfile);
    const goalRequirements = this.computePVBasedGoalRequirements(goals, totalCorpus);
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
      assetClassDataMap: Record<string, AssetClassData>;
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
      const assetClassDataMap: Record<string, AssetClassData> = {};
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

      this.goalStates.set(`${goalId}_basic`, {
        goalId,
        tier: "basic",
        allocatedCorpus: corpus,
        allocatedSIP,
        assetAllocation,
        envelopeBounds,
        confidencePercent,
      });
    }

    // Calculate total allocated SIP
    const totalAllocatedSIP = Array.from(allocations.values()).reduce((sum, sip) => sum + sip, 0);
    return { totalSIP: totalAllocatedSIP, allocations };
  }

  /**
   * Plan ambitious tier goals (envelope method)
   * Allocates only minimum SIP needed for 90% confidence per goal (necessary and sufficient).
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

    const ambitiousGoals = goals.filter((g) => {
      const basicState = this.goalStates.get(`${g.goalId}_basic`);
      if (!basicState || basicState.confidencePercent < CONFIDENCE_CAN_BE_MET) return false;
      // If basic tier's projected mean already meets ambitious target, no need to allocate to ambitious
      const ambitiousTarget = getGoalTarget(g, "ambitious");
      if (basicState.envelopeBounds.mean >= ambitiousTarget) return false;
      return true;
    });

    // Create ambitious states for goals skipped (basic tier already meets ambitious target)
    const skippedAmbitious = goals.filter((g) => {
      const basicState = this.goalStates.get(`${g.goalId}_basic`);
      if (!basicState || basicState.confidencePercent < CONFIDENCE_CAN_BE_MET) return false;
      const ambitiousTarget = getGoalTarget(g, "ambitious");
      return basicState.envelopeBounds.mean >= ambitiousTarget;
    });
    for (const g of skippedAmbitious) {
      allocations.set(g.goalId, 0);
    }
    this.ensureAmbitiousStatesForSkippedGoalsEnvelope(skippedAmbitious);

    if (ambitiousGoals.length === 0) {
      totalSIP = Array.from(allocations.values()).reduce((sum, sip) => sum + sip, 0);
      return { totalSIP, allocations };
    }

    // Compute minimum SIP for 90% confidence (envelope) per ambitious goal
    const minSIPs = new Map<string, number>();
    for (const goal of ambitiousGoals) {
      const goalCorpusAllocation = optimizedCorpus[goal.goalId] || {};
      const goalCorpus = Object.values(goalCorpusAllocation).reduce(
        (sum: number, v: number) => sum + v,
        0
      );
      const target = getGoalTarget(goal, "ambitious");
      const assetAllocation = getOptimalAllocation(
        goal,
        "ambitious",
        customerProfile.corpus.allowedAssetClasses,
        assetClasses
      );
      const timeHorizon = goal.horizonYears <= 3 ? "3Y" : goal.horizonYears <= 5 ? "5Y" : "10Y";
      const assetClassDataMap: Record<string, AssetClassData> = {};
      for (const alloc of assetAllocation) {
        const data = getAssetClassData(assetClasses, alloc.assetClass, timeHorizon);
        if (data) assetClassDataMap[alloc.assetClass] = data;
      }
      const minSIP = calculateMinimumSIPForConfidenceEnvelope(
        target,
        goalCorpus,
        assetAllocation,
        assetClassDataMap,
        goal.horizonYears,
        CONFIDENCE_CAN_BE_MET,
        50,
        this.context.sipInput.annualStepUpPercent
      );
      minSIPs.set(goal.goalId, minSIP);
    }

    // Allocate minSIP to each goal by priority
    const sortedAmbitious = [...ambitiousGoals].sort(
      (a, b) => a.tiers.ambitious.priority - b.tiers.ambitious.priority
    );
    let remainingSIP = availableSIP;
    for (const goal of sortedAmbitious) {
      const minSIP = minSIPs.get(goal.goalId) ?? 0;
      const allocatedSIP = Math.min(minSIP, Math.max(0, remainingSIP));
      remainingSIP -= allocatedSIP;
      allocations.set(goal.goalId, allocatedSIP);
    }

    for (let i = 0; i < ambitiousGoals.length; i++) {
      const goal = ambitiousGoals[i];
      const allocatedSIP = allocations.get(goal.goalId) ?? 0;

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
      const assetClassDataMap: Record<string, AssetClassData> = {};
      const timeHorizon = goal.horizonYears <= 3 ? "3Y" : goal.horizonYears <= 5 ? "5Y" : "10Y";

      for (const alloc of assetAllocation) {
        const data = getAssetClassData(assetClasses, alloc.assetClass, timeHorizon);
        if (data) {
          assetClassDataMap[alloc.assetClass] = data;
        }
      }

      // Store state (include goals with 0 SIP when corpus alone suffices)
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

    totalSIP = Array.from(allocations.values()).reduce((sum, sip) => sum + sip, 0);
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
   * Allocates only minimum SIP needed for 90% confidence per goal (necessary and sufficient, not all available).
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

    // Allocate only minimum SIP needed for 90% confidence per ambitious goal
    const ambitiousGoals = goals.filter((g) => {
      const basicState = this.goalStates.get(`${g.goalId}_basic`);
      if (!basicState || basicState.confidencePercent < CONFIDENCE_CAN_BE_MET) return false;
      // If basic tier's projected mean already meets ambitious target, no need to allocate to ambitious
      const ambitiousTarget = getGoalTarget(g, "ambitious");
      if (basicState.envelopeBounds.mean >= ambitiousTarget) return false;
      return true;
    });

    // Create ambitious states for goals skipped (basic tier already meets ambitious target)
    const skippedAmbitious = goals.filter((g) => {
      const basicState = this.goalStates.get(`${g.goalId}_basic`);
      if (!basicState || basicState.confidencePercent < CONFIDENCE_CAN_BE_MET) return false;
      const ambitiousTarget = getGoalTarget(g, "ambitious");
      return basicState.envelopeBounds.mean >= ambitiousTarget;
    });
    for (const g of skippedAmbitious) {
      allocations.set(g.goalId, 0);
    }
    this.ensureAmbitiousStatesForSkippedGoalsMonteCarlo(skippedAmbitious);

    if (ambitiousGoals.length === 0) {
      totalSIP = Array.from(allocations.values()).reduce((sum, sip) => sum + sip, 0);
      return { totalSIP, allocations };
    }

    // Compute minimum SIP for 90% confidence for each ambitious goal
    const minSIPs = new Map<string, number>();
    for (const goal of ambitiousGoals) {
      const goalCorpusAllocation = optimizedCorpus[goal.goalId] || {};
      const target = getGoalTarget(goal, "ambitious");
      const assetAllocation = getOptimalAllocation(
        goal,
        "ambitious",
        customerProfile.corpus.allowedAssetClasses,
        assetClasses
      );
      const timeHorizon = goal.horizonYears <= 3 ? "3Y" : goal.horizonYears <= 5 ? "5Y" : "10Y";
      const assetClassDataMap: Record<string, AssetClassData> = {};
      for (const alloc of assetAllocation) {
        const data = getAssetClassData(assetClasses, alloc.assetClass, timeHorizon);
        if (data) assetClassDataMap[alloc.assetClass] = data;
      }
      const minSIP = calculateMinimumSIPForConfidenceMonteCarlo(
        target,
        goalCorpusAllocation,
        assetAllocation,
        assetClassDataMap,
        goal.horizonYears,
        monteCarloPaths,
        CONFIDENCE_CAN_BE_MET,
        50,
        this.context.sipInput.annualStepUpPercent
      );
      minSIPs.set(goal.goalId, minSIP);
    }

    // Allocate minSIP to each goal by priority (if SIP insufficient)
    const sortedAmbitious = [...ambitiousGoals].sort(
      (a, b) => a.tiers.ambitious.priority - b.tiers.ambitious.priority
    );
    let remainingSIP = availableSIP;
    for (const goal of sortedAmbitious) {
      const minSIP = minSIPs.get(goal.goalId) ?? 0;
      const allocatedSIP = Math.min(minSIP, Math.max(0, remainingSIP));
      remainingSIP -= allocatedSIP;
      allocations.set(goal.goalId, allocatedSIP);
    }

    for (let i = 0; i < ambitiousGoals.length; i++) {
      const goal = ambitiousGoals[i];
      const allocatedSIP = allocations.get(goal.goalId) ?? 0;

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

    totalSIP = Array.from(allocations.values()).reduce((sum, sip) => sum + sip, 0);
    return { totalSIP, allocations };
  }

  /**
   * Create ambitious goal states for goals skipped because basic tier already meets ambitious target.
   * Ambitious uses same resources (corpus + basic SIP), so bounds and confidence inherit from basic.
   */
  private ensureAmbitiousStatesForSkippedGoalsEnvelope(goals: Goal[]): void {
    for (const goal of goals) {
      const basicState = this.goalStates.get(`${goal.goalId}_basic`);
      if (!basicState) continue;
      const ambitiousTarget = getGoalTarget(goal, "ambitious");
      const confidencePercent = Math.round(calculateConfidencePercent(ambitiousTarget, basicState.envelopeBounds));
      this.goalStates.set(`${goal.goalId}_ambitious`, {
        goalId: goal.goalId,
        tier: "ambitious",
        allocatedCorpus: basicState.allocatedCorpus,
        allocatedSIP: 0,
        assetAllocation: basicState.assetAllocation,
        envelopeBounds: basicState.envelopeBounds,
        confidencePercent,
      });
    }
  }

  /**
   * Create ambitious goal states for goals skipped because basic tier already meets ambitious target (Monte Carlo).
   */
  private ensureAmbitiousStatesForSkippedGoalsMonteCarlo(goals: Goal[]): void {
    for (const goal of goals) {
      const basicState = this.goalStates.get(`${goal.goalId}_basic`);
      if (!basicState) continue;
      const ambitiousTarget = getGoalTarget(goal, "ambitious");
      const confidencePercent = basicState.envelopeBounds.mean >= ambitiousTarget ? 100 : basicState.confidencePercent;
      this.goalStates.set(`${goal.goalId}_ambitious`, {
        goalId: goal.goalId,
        tier: "ambitious",
        allocatedCorpus: basicState.allocatedCorpus,
        allocatedSIP: 0,
        assetAllocation: basicState.assetAllocation,
        envelopeBounds: basicState.envelopeBounds,
        confidencePercent,
      });
    }
  }

  /**
   * Reclaim surplus SIP from basic tiers where confidence > 90%.
   * For each goal with confidence >= CONFIDENCE_CAN_BE_MET, find minimum SIP for 90%,
   * reduce allocation, and return surplus for ambitious tiers.
   */
  private reclaimSurplusSIPFromBasicTiers(
    goals: Goal[],
    optimizedCorpus: Record<string, Record<string, number>>,
    assetClasses: AssetClasses,
    customerProfile: CustomerProfile,
    currentAllocations: Map<string, number>,
    method: "method1" | "method2" | "method3",
    monteCarloPaths: number
  ): { reclaimedAllocations: Map<string, number>; surplusSIP: number } {
    const reclaimedAllocations = new Map<string, number>();
    let surplusSIP = 0;

    for (const goal of goals) {
      const basicState = this.goalStates.get(`${goal.goalId}_basic`);
      const allocatedSIP = currentAllocations.get(goal.goalId) ?? 0;

      if (!basicState || basicState.confidencePercent < CONFIDENCE_CAN_BE_MET || allocatedSIP <= 0) {
        reclaimedAllocations.set(goal.goalId, allocatedSIP);
        continue;
      }

      const goalCorpusAllocation = optimizedCorpus[goal.goalId] || {};
      const target = getGoalTarget(goal, "basic");
      const assetAllocation = basicState.assetAllocation;

      const timeHorizon = goal.horizonYears <= 3 ? "3Y" : goal.horizonYears <= 5 ? "5Y" : "10Y";
      const assetClassDataMap: Record<string, AssetClassData> = {};
      for (const alloc of assetAllocation) {
        const data = getAssetClassData(assetClasses, alloc.assetClass, timeHorizon);
        if (data) {
          assetClassDataMap[alloc.assetClass] = data;
        }
      }

      let minSIP: number;
      if (method === "method1") {
        const goalCorpus = Object.values(goalCorpusAllocation).reduce((sum, v) => sum + v, 0);
        minSIP = calculateMinimumSIPForConfidenceEnvelope(
          target,
          goalCorpus,
          assetAllocation,
          assetClassDataMap,
          goal.horizonYears,
          CONFIDENCE_CAN_BE_MET,
          50,
          this.context.sipInput.annualStepUpPercent
        );
      } else {
        minSIP = calculateMinimumSIPForConfidenceMonteCarlo(
          target,
          goalCorpusAllocation,
          assetAllocation,
          assetClassDataMap,
          goal.horizonYears,
          monteCarloPaths,
          CONFIDENCE_CAN_BE_MET,
          50,
          this.context.sipInput.annualStepUpPercent
        );
      }

      const newAlloc = Math.min(allocatedSIP, Math.max(minSIP, 0));
      const reclaimed = allocatedSIP - newAlloc;
      surplusSIP += reclaimed;
      reclaimedAllocations.set(goal.goalId, newAlloc);

      // Update goalStates with new allocation and recompute bounds/confidence
      const monthlySIPByAssetClass: Record<string, number> = {};
      for (const alloc of assetAllocation) {
        if (alloc.assetClass === "cash") continue;
        monthlySIPByAssetClass[alloc.assetClass] = (newAlloc * alloc.percentage) / 100;
      }

      if (method === "method1") {
        const goalCorpus = Object.values(goalCorpusAllocation).reduce((sum, v) => sum + v, 0);
        const envelopeBounds = calculatePortfolioEnvelopeBounds(
          goalCorpus,
          newAlloc,
          assetAllocation,
          assetClassDataMap,
          goal.horizonYears,
          this.context.sipInput.annualStepUpPercent
        );
        const confidencePercent = Math.round(calculateConfidencePercent(target, envelopeBounds));
        this.goalStates.set(`${goal.goalId}_basic`, {
          ...basicState,
          allocatedSIP: newAlloc,
          envelopeBounds,
          confidencePercent,
        });
      } else {
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
        this.goalStates.set(`${goal.goalId}_basic`, {
          ...basicState,
          allocatedSIP: newAlloc,
          envelopeBounds: bounds,
          confidencePercent,
        });
      }
    }

    return { reclaimedAllocations, surplusSIP };
  }

  /**
   * Reclaim surplus corpus from basic tiers where confidence > 90%.
   * For each goal with confidence > CONFIDENCE_CAN_BE_MET, find minimum corpus for 90%,
   * reduce allocation, and redistribute surplus to goals with confidence < 90%.
   */
  private reclaimSurplusCorpusFromBasicTiers(
    goals: Goal[],
    optimizedCorpus: Record<string, Record<string, number>>,
    sipAllocations: Map<string, number>,
    assetClasses: AssetClasses,
    customerProfile: CustomerProfile,
    method: "method1" | "method2" | "method3",
    monteCarloPaths: number
  ): Record<string, Record<string, number>> {
    const result: Record<string, Record<string, number>> = {};
    let surplusByAssetClass: Record<string, number> = {};

    for (const goal of goals) {
      const basicState = this.goalStates.get(`${goal.goalId}_basic`);
      const goalCorpusAllocation = optimizedCorpus[goal.goalId] || {};
      const allocatedCorpusTotal = Object.values(goalCorpusAllocation).reduce((s, v) => s + v, 0);

      if (!basicState || allocatedCorpusTotal <= 0) {
        result[goal.goalId] = { ...goalCorpusAllocation };
        continue;
      }

      const target = getGoalTarget(goal, "basic");
      const allocatedSIP = sipAllocations.get(goal.goalId) ?? 0;
      const assetAllocation = basicState.assetAllocation;

      const timeHorizon = goal.horizonYears <= 3 ? "3Y" : goal.horizonYears <= 5 ? "5Y" : "10Y";
      const assetClassDataMap: Record<string, AssetClassData> = {};
      for (const alloc of assetAllocation) {
        const data = getAssetClassData(assetClasses, alloc.assetClass, timeHorizon);
        if (data) assetClassDataMap[alloc.assetClass] = data;
      }

      if (basicState.confidencePercent <= CONFIDENCE_CAN_BE_MET) {
        result[goal.goalId] = { ...goalCorpusAllocation };
        continue;
      }

      let minCorpusByAssetClass: Record<string, number>;
      if (method === "method1") {
        const refTotal = allocatedCorpusTotal;
        const         minTotal = calculateMinimumCorpusForConfidenceEnvelope(
          target,
          allocatedSIP,
          refTotal,
          assetAllocation,
          assetClassDataMap,
          goal.horizonYears,
          CORPUS_RECLAIM_TARGET_CONFIDENCE,
          50,
          this.context.sipInput.annualStepUpPercent
        );
        const scale = refTotal > 0 ? minTotal / refTotal : 0;
        minCorpusByAssetClass = {};
        for (const [ac, amt] of Object.entries(goalCorpusAllocation)) {
          minCorpusByAssetClass[ac] = amt * scale;
        }
      } else {
        const monthlySIPByAssetClass: Record<string, number> = {};
        for (const alloc of assetAllocation) {
          if (alloc.assetClass === "cash") continue;
          monthlySIPByAssetClass[alloc.assetClass] = (allocatedSIP * alloc.percentage) / 100;
        }
        minCorpusByAssetClass = calculateMinimumCorpusForConfidenceMonteCarlo(
          target,
          monthlySIPByAssetClass,
          goalCorpusAllocation,
          assetAllocation,
          assetClassDataMap,
          goal.horizonYears,
          monteCarloPaths,
          CORPUS_RECLAIM_TARGET_CONFIDENCE,
          50,
          this.context.sipInput.annualStepUpPercent
        );
      }

      const newAlloc: Record<string, number> = {};
      for (const ac of Object.keys(goalCorpusAllocation)) {
        const current = goalCorpusAllocation[ac] || 0;
        const minVal = minCorpusByAssetClass[ac] || 0;
        const alloc = Math.min(current, Math.max(minVal, 0));
        newAlloc[ac] = alloc;
        const reclaimed = current - alloc;
        surplusByAssetClass[ac] = (surplusByAssetClass[ac] || 0) + reclaimed;
      }
      result[goal.goalId] = newAlloc;
    }

    const totalSurplus = Object.values(surplusByAssetClass).reduce((s, v) => s + v, 0);
    if (totalSurplus <= 0) {
      return result;
    }

    const goalsNeedingCorpus = goals.filter((g) => {
      const state = this.goalStates.get(`${g.goalId}_basic`);
      return state && state.confidencePercent < CONFIDENCE_CAN_BE_MET && state.allocatedCorpus >= 0;
    });

    if (goalsNeedingCorpus.length === 0) {
      // No goals need surplus; redistribute back to preserve total corpus
      const totalAllocated = Object.values(result).reduce(
        (s, g) => s + Object.values(g).reduce((a, v) => a + v, 0),
        0
      );
      const totalToRestore = Object.values(surplusByAssetClass).reduce((s, v) => s + v, 0);
      if (totalToRestore > 0 && totalAllocated > 0) {
        for (const goal of goals) {
          const current = result[goal.goalId] || {};
          const currentTotal = Object.values(current).reduce((s, v) => s + v, 0);
          const share = currentTotal / totalAllocated;
          const addTotal = totalToRestore * share;
          const assetAllocation = getOptimalAllocation(
            goal,
            "basic",
            customerProfile.corpus.allowedAssetClasses,
            assetClasses
          );
          const updated: Record<string, number> = {};
          for (const alloc of assetAllocation) {
            if (alloc.assetClass === "cash") continue;
            const pct = alloc.percentage / 100;
            const add = addTotal * pct;
            const surplusForAc = surplusByAssetClass[alloc.assetClass] || 0;
            const actualAdd = Math.min(add, surplusForAc);
            updated[alloc.assetClass] = (current[alloc.assetClass] || 0) + actualAdd;
            surplusByAssetClass[alloc.assetClass] = surplusForAc - actualAdd;
          }
          result[goal.goalId] = updated;
        }
      }
      return result;
    }

    const pvByGoal = new Map<string, number>();
    for (const goal of goalsNeedingCorpus) {
      const assetAllocation = getOptimalAllocation(
        goal,
        "basic",
        customerProfile.corpus.allowedAssetClasses,
        assetClasses
      );
      const timeHorizon = goal.horizonYears <= 3 ? "3Y" : goal.horizonYears <= 5 ? "5Y" : "10Y";
      const assetClassDataMap: Record<string, AssetClassData> = {};
      for (const alloc of assetAllocation) {
        const data = getAssetClassData(assetClasses, alloc.assetClass, timeHorizon);
        if (data) assetClassDataMap[alloc.assetClass] = data;
      }
      const pv = calculatePresentValueOfTarget(
        getGoalTarget(goal, "basic"),
        assetAllocation,
        assetClassDataMap,
        goal.horizonYears
      );
      pvByGoal.set(goal.goalId, pv);
    }
    const totalPV = Array.from(pvByGoal.values()).reduce((s, v) => s + v, 0);

    for (const goal of goalsNeedingCorpus) {
      const pv = pvByGoal.get(goal.goalId) || 0;
      const share = totalPV > 0 ? (pv / totalPV) * totalSurplus : totalSurplus / goalsNeedingCorpus.length;
      const assetAllocation = getOptimalAllocation(
        goal,
        "basic",
        customerProfile.corpus.allowedAssetClasses,
        assetClasses
      );
      const existing = result[goal.goalId] || {};
      const updated: Record<string, number> = {};
      for (const alloc of assetAllocation) {
        if (alloc.assetClass === "cash") continue;
        const pct = alloc.percentage / 100;
        const add = share * pct;
        const surplusForAc = surplusByAssetClass[alloc.assetClass] || 0;
        const actualAdd = Math.min(add, surplusForAc);
        updated[alloc.assetClass] = (existing[alloc.assetClass] || 0) + actualAdd;
        surplusByAssetClass[alloc.assetClass] = surplusForAc - actualAdd;
      }
      result[goal.goalId] = updated;
    }

    // Distribute any leftover surplus (from asset-class mismatch) to preserve total
    const leftover = Object.values(surplusByAssetClass).reduce((s, v) => s + v, 0);
    if (leftover > 0) {
      const totalAlloc = Object.values(result).reduce(
        (s, g) => s + Object.values(g).reduce((a, v) => a + v, 0),
        0
      );
      if (totalAlloc > 0) {
        for (const goal of goals) {
          const cur = result[goal.goalId] || {};
          const curTot = Object.values(cur).reduce((a, v) => a + v, 0);
          const sh = curTot / totalAlloc;
          const addTot = leftover * sh;
          const assetAlloc = getOptimalAllocation(
            goal,
            "basic",
            customerProfile.corpus.allowedAssetClasses,
            assetClasses
          );
          const upd: Record<string, number> = {};
          for (const alloc of assetAlloc) {
            if (alloc.assetClass === "cash") continue;
            const pct = alloc.percentage / 100;
            const add = addTot * pct;
            const sup = surplusByAssetClass[alloc.assetClass] || 0;
            const act = Math.min(add, sup);
            upd[alloc.assetClass] = (cur[alloc.assetClass] || 0) + act;
            surplusByAssetClass[alloc.assetClass] = sup - act;
          }
          result[goal.goalId] = upd;
        }
      }
    }

    // Update goal states with new corpus allocations
    for (const goal of goals) {
      const basicState = this.goalStates.get(`${goal.goalId}_basic`);
      const newCorpus = result[goal.goalId] || {};
      if (!basicState) continue;

      const target = getGoalTarget(goal, "basic");
      const allocatedSIP = sipAllocations.get(goal.goalId) ?? 0;
      const assetAllocation = basicState.assetAllocation;

      const timeHorizon = goal.horizonYears <= 3 ? "3Y" : goal.horizonYears <= 5 ? "5Y" : "10Y";
      const assetClassDataMap: Record<string, AssetClassData> = {};
      for (const alloc of assetAllocation) {
        const data = getAssetClassData(assetClasses, alloc.assetClass, timeHorizon);
        if (data) assetClassDataMap[alloc.assetClass] = data;
      }

      const monthlySIPByAssetClass: Record<string, number> = {};
      for (const alloc of assetAllocation) {
        if (alloc.assetClass === "cash") continue;
        monthlySIPByAssetClass[alloc.assetClass] = (allocatedSIP * alloc.percentage) / 100;
      }

      if (method === "method1") {
        const goalCorpus = Object.values(newCorpus).reduce((s, v) => s + v, 0);
        const envelopeBounds = calculatePortfolioEnvelopeBounds(
          goalCorpus,
          allocatedSIP,
          assetAllocation,
          assetClassDataMap,
          goal.horizonYears,
          this.context.sipInput.annualStepUpPercent
        );
        const confidencePercent = Math.round(calculateConfidencePercent(target, envelopeBounds));
        this.goalStates.set(`${goal.goalId}_basic`, {
          ...basicState,
          allocatedCorpus: goalCorpus,
          envelopeBounds,
          confidencePercent,
        });
      } else {
        const paths = runPortfolioMonteCarloSimulationLognormal(
          newCorpus,
          monthlySIPByAssetClass,
          assetAllocation,
          assetClassDataMap,
          goal.horizonYears,
          monteCarloPaths,
          this.context.sipInput.annualStepUpPercent
        );
        const bounds = calculateMonteCarloBounds(paths);
        const confidencePercent = Math.round(calculateMonteCarloConfidence(paths, target));
        this.goalStates.set(`${goal.goalId}_basic`, {
          ...basicState,
          allocatedCorpus: Object.values(newCorpus).reduce((s, v) => s + v, 0),
          envelopeBounds: bounds,
          confidencePercent,
        });
      }
    }

    return result;
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

          // Determine status: if mean meets target and confidence is reasonable, treat as can_be_met
          const roundedConfidence = Math.round(confidencePercent);
          const meanMeetsTarget = Math.max(perGoalMean, portfolioMean) >= targetAmount;
          if (meanMeetsTarget && roundedConfidence >= CONFIDENCE_AT_RISK_MIN) {
            status = "can_be_met";
          } else if (roundedConfidence >= CONFIDENCE_CAN_BE_MET) {
            status = "can_be_met";
          } else if (roundedConfidence >= CONFIDENCE_AT_RISK_MIN) {
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

          // Determine status: if mean meets target and confidence is reasonable, treat as can_be_met
          const roundedConfidence = Math.round(confidencePercent);
          const meanMeetsTarget = Math.max(perGoalMean, portfolioMean) >= targetAmount;
          if (meanMeetsTarget && roundedConfidence >= CONFIDENCE_AT_RISK_MIN) {
            status = "can_be_met";
          } else if (roundedConfidence >= CONFIDENCE_CAN_BE_MET) {
            status = "can_be_met";
          } else if (roundedConfidence >= CONFIDENCE_AT_RISK_MIN) {
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
