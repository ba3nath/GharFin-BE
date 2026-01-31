/**
 * Test helper utilities that use core functions
 * These helpers should NOT duplicate core logic - they use actual core functions
 */

import {
  calculatePortfolioEnvelopeBounds,
  calculateConfidencePercent,
} from '../../engine/envelope';
import {
  getOptimalAllocation,
  AssetAllocation,
} from '../../engine/portfolio';
import { getAssetClassData } from '../../models/AssetClass';
import { getTimeHorizonKey } from '../../utils/time';
import { yearsToMonths } from '../../utils/time';
import { annualToMonthlyReturn } from '../../utils/math';
import { calculateAvgPositiveReturn } from '../../models/AssetClass';
import { Goal } from '../../models/Goal';
import { AssetClasses } from '../../models/AssetClass';
import { corpusAtTimeWithStepUp } from '../../utils/math';

/**
 * Find corpus that achieves approximately 90% confidence using binary search
 * Uses actual core functions to calculate confidence
 */
export function findCorpusFor90Confidence(
  targetAmount: number,
  horizonYears: number,
  assetAllocations: AssetAllocation[],
  assetClassDataMap: Record<string, any>,
  monthlySIP: number = 0,
  stepUpPercent: number = 0,
  maxIterations: number = 20
): number {
  const months = yearsToMonths(horizonYears);
  
  // Calculate weighted portfolio metrics for lower bound estimation
  let weightedReturn = 0;
  let weightedProbNegative = 0;
  let weightedExpectedShortfall = 0;
  let totalWeight = 0;

  for (const allocation of assetAllocations) {
    if (allocation.assetClass === "cash") continue;
    const data = assetClassDataMap[allocation.assetClass];
    if (!data) continue;

    const weight = allocation.percentage / 100;
    totalWeight += weight;

    weightedReturn += (data.avgReturnPct / 100) * weight;
    weightedProbNegative += (data.probNegativeYearPct / 100) * weight;
    weightedExpectedShortfall += (data.expectedShortfallPct / 100) * weight;
  }

  if (totalWeight > 0) {
    weightedReturn /= totalWeight;
    weightedProbNegative /= totalWeight;
    weightedExpectedShortfall /= totalWeight;
  }

  // Estimate required corpus using lower bound calculation
  const avgPositiveReturn = (weightedReturn - weightedProbNegative * weightedExpectedShortfall) / (1 - weightedProbNegative || 0.01);
  const lowerAnnualReturn = weightedProbNegative * weightedExpectedShortfall + (1 - weightedProbNegative) * avgPositiveReturn;
  const lowerMonthlyReturn = annualToMonthlyReturn(lowerAnnualReturn);

  // Work backwards to estimate initial corpus
  let estimatedCorpus: number;
  if (stepUpPercent > 0) {
    const sipFV = corpusAtTimeWithStepUp(0, monthlySIP, stepUpPercent, lowerMonthlyReturn, months);
    const corpusFVFactor = Math.pow(1 + lowerMonthlyReturn, months);
    estimatedCorpus = (targetAmount - sipFV) / corpusFVFactor;
  } else {
    const sipFV = monthlySIP === 0 ? 0 : monthlySIP * ((Math.pow(1 + lowerMonthlyReturn, months) - 1) / (lowerMonthlyReturn || 1));
    const corpusFVFactor = Math.pow(1 + lowerMonthlyReturn, months);
    estimatedCorpus = (targetAmount - sipFV) / corpusFVFactor;
  }

  // Binary search using actual core functions
  let lowCorpus = estimatedCorpus * 0.8;
  let highCorpus = estimatedCorpus * 1.2;
  let testCorpus = estimatedCorpus;
  let iterations = 0;
  
  while (iterations < maxIterations) {
    testCorpus = (lowCorpus + highCorpus) / 2;
    
    // Use actual core function to calculate envelope bounds
    const envelopeBounds = calculatePortfolioEnvelopeBounds(
      testCorpus,
      monthlySIP,
      assetAllocations,
      assetClassDataMap,
      horizonYears,
      stepUpPercent
    );
    
    // Use actual core function to calculate confidence
    const confidence = calculateConfidencePercent(targetAmount, envelopeBounds);
    
    if (Math.abs(confidence - 90) < 1) {
      break; // Close enough to 90%
    }
    
    if (confidence < 90) {
      lowCorpus = testCorpus; // Need more corpus
    } else {
      highCorpus = testCorpus; // Can use less corpus
    }
    
    iterations++;
  }
  
  return testCorpus;
}

/**
 * Create customer profile with corpus allocated by asset class
 */
export function createProfileWithCorpus(
  totalCorpus: number,
  assetAllocations: AssetAllocation[],
  allowedAssetClasses: string[],
  asOfDate: string = '2024-01-01'
) {
  const corpusByAssetClass: Record<string, number> = {};
  for (const alloc of assetAllocations) {
    if (alloc.assetClass === 'cash') continue;
    corpusByAssetClass[alloc.assetClass] = (totalCorpus * alloc.percentage) / 100;
  }

  return {
    asOfDate,
    totalNetWorth: totalCorpus,
    corpus: {
      byAssetClass: corpusByAssetClass,
      allowedAssetClasses: allowedAssetClasses,
    },
  };
}

/**
 * Get asset class data map for allocations
 */
export function buildAssetClassDataMap(
  assetClasses: AssetClasses,
  assetAllocations: AssetAllocation[],
  timeHorizon: string
): Record<string, any> {
  const assetClassDataMap: Record<string, any> = {};
  for (const alloc of assetAllocations) {
    if (alloc.assetClass === 'cash') continue;
    const data = getAssetClassData(assetClasses, alloc.assetClass, timeHorizon as "3Y" | "5Y" | "10Y");
    if (data) {
      assetClassDataMap[alloc.assetClass] = data;
    }
  }
  return assetClassDataMap;
}

/**
 * Find corpus that achieves target confidence using iterative approach
 * Uses actual GoalPlanner to ensure we're testing the real behavior
 */
export async function findCorpusForTargetConfidence(
  findConfidence: (corpus: number) => Promise<number>,
  targetConfidence: number,
  initialEstimate: number,
  tolerance: number = 1,
  maxIterations: number = 20
): Promise<number> {
  let lowCorpus = initialEstimate * 0.8;
  let highCorpus = initialEstimate * 1.2;
  let testCorpus = initialEstimate;
  let iterations = 0;
  
  while (iterations < maxIterations) {
    testCorpus = (lowCorpus + highCorpus) / 2;
    
    const confidence = await findConfidence(testCorpus);
    
    if (Math.abs(confidence - targetConfidence) < tolerance) {
      break;
    }
    
    if (confidence < targetConfidence) {
      lowCorpus = testCorpus;
    } else {
      highCorpus = testCorpus;
    }
    
    iterations++;
  }
  
  return testCorpus;
}
