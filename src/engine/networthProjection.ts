import { PlanningResult, Method1Result, Method2Result, Method3Result } from "../models/PlanningResult";
import { Goal, getGoalTarget } from "../models/Goal";
import { CustomerProfile, getTotalCorpus } from "../models/CustomerProfile";
import { AssetClasses, getAssetClassData } from "../models/AssetClass";
import { AssetAllocation, getOptimalAllocation, getTimeBasedAllocation, calculateWeightedMetrics } from "./portfolio";
import { NetworthProjectionData, MonthlyNetworthData } from "../models/NetworthProjection";
import { SIPInput } from "../planner/goalPlanner";
import { yearsToMonths, isInLast12Months } from "../utils/time";
import { annualToMonthlyReturn } from "../utils/math";

/**
 * Calculate networth projection for a planning method
 * @param tier - "basic" to withdraw basic tier corpus, "ambitious" to withdraw ambitious tier corpus
 */
export function calculateNetworthProjection(
  method: "method1" | "method2" | "method3",
  planningResult: PlanningResult,
  goals: Goal[],
  customerProfile: CustomerProfile,
  assetClasses: AssetClasses,
  sipInput: SIPInput,
  tier: "basic" | "ambitious" = "basic"
): NetworthProjectionData {
  // Find longest goal horizon
  const maxHorizonMonths = Math.max(...goals.map(g => yearsToMonths(g.horizonYears)));
  
  // Get initial corpus allocation by goal
  const initialCorpusByGoal = planningResult.corpusAllocation;
  
  // Get SIP allocation by goal
  const sipByGoal: Record<string, number> = {};
  for (const allocation of planningResult.sipAllocation.perGoalAllocations) {
    const goalId = allocation.goalId.replace("_basic", "").replace("_ambitious", "");
    if (!sipByGoal[goalId]) {
      sipByGoal[goalId] = 0;
    }
    sipByGoal[goalId] += allocation.monthlyAmount;
  }
  
  // Initialize corpus tracking by goal and asset class
  const corpusByGoalAndAsset: Record<string, Record<string, number>> = {};
  const basicTierCorpusByGoal: Record<string, number> = {};
  
  // Store target amounts for each goal
  const basicTierTargetByGoal: Record<string, number> = {};
  const ambitiousTierTargetByGoal: Record<string, number> = {};
  
  for (const goal of goals) {
    const goalCorpusAlloc = initialCorpusByGoal[goal.goalId] || {};
    corpusByGoalAndAsset[goal.goalId] = { ...goalCorpusAlloc };
    
    // Calculate basic tier corpus (sum of all asset classes for this goal)
    basicTierCorpusByGoal[goal.goalId] = Object.values(goalCorpusAlloc).reduce(
      (sum, amount) => sum + amount,
      0
    );
    
    // Store target amounts
    basicTierTargetByGoal[goal.goalId] = getGoalTarget(goal, "basic");
    ambitiousTierTargetByGoal[goal.goalId] = getGoalTarget(goal, "ambitious");
  }
  
  // Monthly projection data
  const monthlyValues: MonthlyNetworthData[] = [];
  
  // Track current SIP by goal (will grow with step-up)
  const currentSIPByGoal: Record<string, number> = { ...sipByGoal };
  
  // Calculate initial total networth (sum of all corpus allocated to goals)
  const month0CorpusByGoal: Record<string, number> = {};
  let initialTotalCorpus = 0;
  for (const goal of goals) {
    const goalCorpus = basicTierCorpusByGoal[goal.goalId];
    month0CorpusByGoal[goal.goalId] = goalCorpus;
    initialTotalCorpus += goalCorpus;
  }
  
  monthlyValues.push({
    month: 0,
    totalNetworth: initialTotalCorpus,
    corpusByGoal: month0CorpusByGoal,
    sipContributions: 0,
  });
  
  // Track which goals have had their basic tier removed
  const goalsWithRemovedBasicTier = new Set<string>();
  
  // Track final corpus value for each goal after withdrawal (can be negative for shortfalls)
  const finalCorpusByGoal: Record<string, number> = {};
  
  // Get goal feasibility data from planning result based on tier (needed for withdrawal logic)
  const goalFeasibilityMap = new Map<string, { 
    confidencePercent: number; 
    status: "can_be_met" | "at_risk" | "cannot_be_met";
    projectedLower?: number;
    projectedMean?: number;
  }>();
  for (const row of planningResult.goalFeasibilityTable.rows) {
    if (row.tier === tier) {
      goalFeasibilityMap.set(row.goalId, {
        confidencePercent: row.confidencePercent,
        status: row.status,
        projectedLower: row.projectedCorpus.lower,
        projectedMean: row.projectedCorpus.mean,
      });
    }
  }
  
  // Project month by month
  for (let month = 1; month <= maxHorizonMonths; month++) {
    const events: string[] = [];
    let totalNetworth = 0;
    const corpusByGoal: Record<string, number> = {};
    
    // Process each goal
    for (const goal of goals) {
      const goalId = goal.goalId;
      const goalHorizonMonths = yearsToMonths(goal.horizonYears);
      
      // Skip if goal is past due and already processed
      // Use the stored final corpus value (which can be negative for shortfalls)
      if (month > goalHorizonMonths && goalsWithRemovedBasicTier.has(goalId)) {
        // Get the final corpus value stored after withdrawal (can be negative)
        const finalCorpus = finalCorpusByGoal[goalId] ?? 0;
        corpusByGoal[goalId] = finalCorpus; // This can be negative
        totalNetworth += finalCorpus;
        continue;
      }
      
      // Get asset allocation for this goal at current month
      const isLast12Months = isInLast12Months(month - 1, goalHorizonMonths);
      const baseAllocation = getOptimalAllocation(
        goal,
        "basic",
        customerProfile.corpus.allowedAssetClasses,
        assetClasses,
        month - 1
      );
      
      const assetAllocation = isLast12Months
        ? getTimeBasedAllocation(
            goal.horizonYears,
            month - 1,
            goalHorizonMonths,
            baseAllocation,
            customerProfile.corpus.allowedAssetClasses
          )
        : baseAllocation;
      
      // Get time horizon for asset class data
      const timeHorizon = goal.horizonYears <= 3 ? "3Y" : goal.horizonYears <= 5 ? "5Y" : "10Y";
      
      // Build asset class data map
      const assetClassDataMap: Record<string, any> = {};
      for (const alloc of assetAllocation) {
        const data = getAssetClassData(assetClasses, alloc.assetClass, timeHorizon);
        if (data) {
          assetClassDataMap[alloc.assetClass] = data;
        }
      }
      
      // Calculate weighted monthly return for the current allocation
      const portfolioMetrics = calculateWeightedMetrics(assetAllocation, assetClassDataMap);
      const weightedMonthlyReturn = annualToMonthlyReturn(portfolioMetrics.return);
      
      // Apply returns to corpus for each asset class individually
      // In last 12 months, the allocation shifts to bonds, but existing corpus
      // still grows according to its current asset class distribution
      let goalCorpus = 0;
      for (const alloc of assetAllocation) {
        if (alloc.assetClass === "cash") {
          // Cash has no return, but still count it
          if (corpusByGoalAndAsset[goalId]?.[alloc.assetClass] !== undefined) {
            goalCorpus += corpusByGoalAndAsset[goalId][alloc.assetClass];
          }
          continue;
        }
        
        const assetClassData = assetClassDataMap[alloc.assetClass];
        if (!assetClassData) continue;
        
        // Get monthly return for this asset class
        const annualReturn = assetClassData.avgReturnPct / 100;
        const monthlyReturn = annualToMonthlyReturn(annualReturn);
        
        const assetClassCorpus = corpusByGoalAndAsset[goalId]?.[alloc.assetClass] || 0;
        if (assetClassCorpus > 0) {
          // Apply monthly return
          const newCorpus = assetClassCorpus * (1 + monthlyReturn);
          corpusByGoalAndAsset[goalId][alloc.assetClass] = newCorpus;
          goalCorpus += newCorpus;
        }
      }
      
      // Add SIP contribution for this goal
      const goalSIP = currentSIPByGoal[goalId] || 0;
      if (goalSIP > 0) {
        // Allocate SIP by asset class percentages
        for (const alloc of assetAllocation) {
          if (alloc.assetClass === "cash") continue;
          
          const sipAmount = goalSIP * (alloc.percentage / 100);
          if (!corpusByGoalAndAsset[goalId]) {
            corpusByGoalAndAsset[goalId] = {};
          }
          if (!corpusByGoalAndAsset[goalId][alloc.assetClass]) {
            corpusByGoalAndAsset[goalId][alloc.assetClass] = 0;
          }
          corpusByGoalAndAsset[goalId][alloc.assetClass] += sipAmount;
          goalCorpus += sipAmount;
        }
      }
      
      // Check if goal due date is reached (at exact month, after processing returns and SIP)
      if (month === goalHorizonMonths && !goalsWithRemovedBasicTier.has(goalId)) {
        // Remove corpus at due date (after month's processing)
        goalsWithRemovedBasicTier.add(goalId);
        events.push(`goal_due:${goalId}`);
        
        // Determine target amount to remove based on tier
        const targetAmount = tier === "basic" 
          ? basicTierTargetByGoal[goalId]
          : ambitiousTierTargetByGoal[goalId];
        
        // Get feasibility data for this goal
        const feasibility = goalFeasibilityMap.get(goalId);
        
        // For ambitious tier goals that cannot be met, use the projected mean from feasibility table
        // This ensures we use the same projection method as the planning algorithm
        // For other cases, use the actual calculated corpus (which uses mean returns month-by-month)
        let currentGoalCorpus = goalCorpus;
        if (tier === "ambitious" && feasibility && feasibility.status === "cannot_be_met" && feasibility.projectedMean !== undefined) {
          // Use the projected mean from feasibility table for cannot_be_met ambitious goals
          // This matches what the planning algorithm calculated
          currentGoalCorpus = feasibility.projectedMean;
        }
        
        // Remove the target amount from the corpus
        // This will reduce networth by exactly the target amount
        const remainingCorpus = currentGoalCorpus - targetAmount;
        
        // Proportionally reduce corpus across asset classes
        if (currentGoalCorpus > 0) {
          if (remainingCorpus >= 0) {
            // Normal case: enough corpus to cover withdrawal
            const reductionRatio = remainingCorpus / currentGoalCorpus;
            for (const assetClass of Object.keys(corpusByGoalAndAsset[goalId] || {})) {
              const currentAmount = corpusByGoalAndAsset[goalId][assetClass] || 0;
              corpusByGoalAndAsset[goalId][assetClass] = currentAmount * reductionRatio;
            }
            goalCorpus = remainingCorpus;
          } else {
            // Corpus is less than target amount - remove all and allow negative
            // This represents a shortfall that needs to be covered from other sources
            for (const assetClass of Object.keys(corpusByGoalAndAsset[goalId] || {})) {
              corpusByGoalAndAsset[goalId][assetClass] = 0;
            }
            goalCorpus = remainingCorpus; // This will be negative
          }
        } else {
          // No corpus available - still remove the target amount (negative networth)
          goalCorpus = -targetAmount;
        }
        
        // Store the final corpus value (can be negative) for use in subsequent months
        // This ensures the negative shortfall persists and impacts total networth
        finalCorpusByGoal[goalId] = goalCorpus;
      }
      
      corpusByGoal[goalId] = goalCorpus;
      totalNetworth += goalCorpus;
    }
    
    // Apply step-up at start of each year (after month 0)
    if (month > 0 && month % 12 === 0 && sipInput.annualStepUpPercent > 0) {
      for (const goalId of Object.keys(currentSIPByGoal)) {
        currentSIPByGoal[goalId] *= (1 + sipInput.annualStepUpPercent / 100);
      }
      events.push(`step_up:${month}`);
    }
    
    // Calculate cumulative SIP contributions
    let cumulativeSIP = 0;
    for (const goalId of Object.keys(sipByGoal)) {
      const initialSIP = sipByGoal[goalId];
      let cumulativeForGoal = 0;
      
      for (let m = 1; m <= month; m++) {
        // Calculate SIP for month m (accounting for step-ups)
        const yearsPassed = Math.floor((m - 1) / 12);
        const sipForMonth = initialSIP * Math.pow(1 + sipInput.annualStepUpPercent / 100, yearsPassed);
        cumulativeForGoal += sipForMonth;
      }
      
      cumulativeSIP += cumulativeForGoal;
    }
    
    monthlyValues.push({
      month,
      totalNetworth,
      corpusByGoal: { ...corpusByGoal },
      sipContributions: cumulativeSIP,
      events: events.length > 0 ? events : undefined,
    });
  }
  
  // Build metadata
  const metadata = {
    initialTotalCorpus: initialTotalCorpus,
    totalMonthlySIP: Object.values(sipByGoal).reduce((sum, sip) => sum + sip, 0),
    stepUpPercent: sipInput.annualStepUpPercent,
    goals: goals.map(goal => {
      const feasibility = goalFeasibilityMap.get(goal.goalId);
      return {
        goalId: goal.goalId,
        goalName: goal.goalName,
        horizonMonths: yearsToMonths(goal.horizonYears),
        basicTierCorpus: basicTierCorpusByGoal[goal.goalId] || 0,
        confidencePercent: feasibility?.confidencePercent,
        status: feasibility?.status,
      };
    }),
  };
  
  return {
    method: `${method}_${tier}` as any,
    monthlyValues,
    maxMonth: maxHorizonMonths,
    metadata,
  };
}
