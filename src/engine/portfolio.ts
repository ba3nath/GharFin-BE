import { AssetClassData, AssetClasses, calculateAvgPositiveReturn } from "../models/AssetClass";
import { getTimeHorizonKey, isInLast12Months } from "../utils/time";
import { annualToMonthlyReturn } from "../utils/math";

/**
 * Asset allocation configuration for a goal.
 * Defines how much of the portfolio should be allocated to each asset class.
 * 
 * @property assetClass - Name of the asset class (e.g., "largeCap", "bond")
 * @property percentage - Allocation percentage (0-100)
 */
export interface AssetAllocation {
  assetClass: string;
  percentage: number;
}

/**
 * Portfolio metrics used for optimization.
 * Includes return, volatility (approximated), and Sharpe ratio.
 */
export interface PortfolioMetrics {
  return: number;
  volatility: number;
  sharpeRatio: number;
}

/**
 * Calculate portfolio metrics from asset allocations
 * Uses probability-based risk metrics instead of volatility
 */
export function calculatePortfolioMetrics(
  allocations: AssetAllocation[],
  assetClassDataMap: Record<string, AssetClassData>
): PortfolioMetrics {
  let weightedReturn = 0;
  let weightedProbNegative = 0;
  let weightedExpectedShortfall = 0;
  let totalWeight = 0;

  for (const allocation of allocations) {
    // Skip cash - it has no return/risk metrics
    if (allocation.assetClass === "cash") {
      continue;
    }

    const data = assetClassDataMap[allocation.assetClass];
    if (!data) continue;

    const weight = allocation.percentage / 100;
    totalWeight += weight;

    weightedReturn += (data.avgReturnPct / 100) * weight;
    weightedProbNegative += (data.probNegativeYearPct / 100) * weight;
    weightedExpectedShortfall += (data.expectedShortfallPct / 100) * weight;
  }

  // Normalize by total weight
  if (totalWeight > 0) {
    weightedReturn /= totalWeight;
    weightedProbNegative /= totalWeight;
    weightedExpectedShortfall /= totalWeight;
  }

  // Calculate approximate volatility for Sharpe ratio using expected shortfall
  // This is a rough approximation for optimization purposes
  // Volatility ≈ |expectedShortfall| * sqrt(probNegative / (1 - probNegative))
  const volatility = Math.abs(weightedExpectedShortfall) * Math.sqrt(
    weightedProbNegative / (1 - weightedProbNegative || 0.01)
  );
  
  const sharpeRatio = volatility > 0 ? weightedReturn / volatility : 0;

  return {
    return: weightedReturn,
    volatility,
    sharpeRatio,
  };
}

/**
 * Get time-based asset allocation for a basic goal
 * Shifts to bonds in last 12 months
 */
export function getTimeBasedAllocation(
  goalHorizonYears: number,
  currentMonth: number,
  totalMonths: number,
  growthAllocation: AssetAllocation[],
  allowedAssetClasses: string[]
): AssetAllocation[] {
  // If not in last 12 months, use growth allocation
  if (!isInLast12Months(currentMonth, totalMonths)) {
    return growthAllocation;
  }

  if (growthAllocation.length === 0) {
    return growthAllocation;
  }

  if (!allowedAssetClasses.includes("bond")) {
    return growthAllocation;
  }

  // In last 12 months, shift to bonds
  // Find bond allocation if it exists
  const bondAllocation = growthAllocation.find((a) => a.assetClass === "bond");

  if (bondAllocation) {
    // Increase bond allocation, decrease others proportionally
    const bondTarget = 80; // 80% bonds in last 12 months
    const bondCurrent = bondAllocation.percentage;
    const bondIncrease = bondTarget - bondCurrent;

    if (bondIncrease <= 0) {
      return growthAllocation;
    }

    // Calculate total non-bond percentage
    const nonBondTotal = growthAllocation
      .filter((a) => a.assetClass !== "bond")
      .reduce((sum, a) => sum + a.percentage, 0);

    if (nonBondTotal === 0) {
      return growthAllocation;
    }

    // Redistribute: reduce non-bond assets proportionally
    const newAllocations: AssetAllocation[] = growthAllocation.map((alloc) => {
      if (alloc.assetClass === "bond") {
        return { ...alloc, percentage: Math.round(bondTarget) };
      } else {
        const reduction = (alloc.percentage / nonBondTotal) * bondIncrease;
        return { ...alloc, percentage: Math.max(0, alloc.percentage - reduction) };
      }
    });

    // Normalize to 100%
    const total = newAllocations.reduce((sum, a) => sum + a.percentage, 0);
    return newAllocations.map((a) => ({
      ...a,
      percentage: Math.round((a.percentage / total) * 100),
    }));
  }

  // If no bond in allocation, add it
  const newAllocations: AssetAllocation[] = [...growthAllocation];
  const bondPercentage = 80;
  const reductionFactor = (100 - bondPercentage) / 100;

  // Reduce existing allocations
  const adjusted = newAllocations.map((a) => ({
    ...a,
    percentage: Math.round(a.percentage * reductionFactor),
  }));

  // Add bond
  adjusted.push({ assetClass: "bond", percentage: Math.round(bondPercentage) });

  return adjusted;
}

/**
 * Optimize asset allocation using Sharpe ratio maximization
 */
export function optimizeSharpeRatio(
  allowedAssetClasses: string[],
  assetClasses: AssetClasses,
  timeHorizon: "3Y" | "5Y" | "10Y"
): AssetAllocation[] {
  // Get asset class data (exclude cash)
  const assetData: Array<{
    name: string;
    return: number;
    volatility: number;
    sharpeRatio: number;
  }> = [];

  for (const assetClass of allowedAssetClasses) {
    // Skip cash - it has no return/volatility data
    if (assetClass === "cash") {
      continue;
    }

    const data = assetClasses[assetClass]?.[timeHorizon];
    if (data) {
      const return_ = data.avgReturnPct / 100;
      // Approximate volatility from risk metrics for Sharpe ratio
      const probNegative = data.probNegativeYearPct / 100;
      const expectedShortfall = Math.abs(data.expectedShortfallPct) / 100;
      const volatility = expectedShortfall * Math.sqrt(probNegative / (1 - probNegative || 0.01));
      const sharpeRatio = volatility > 0 ? return_ / volatility : 0;
      assetData.push({ name: assetClass, return: return_, volatility, sharpeRatio });
    }
  }

  if (assetData.length === 0) {
    return [];
  }

  // Sort by Sharpe ratio (descending)
  assetData.sort((a, b) => b.sharpeRatio - a.sharpeRatio);

  // Simple optimization: allocate more to higher Sharpe ratio assets
  // This is a simplified approach - in production, you'd use more sophisticated optimization
  const allocations: AssetAllocation[] = [];
  const totalSharpe = assetData.reduce((sum, a) => sum + a.sharpeRatio, 0);

  if (totalSharpe === 0) {
    // Equal allocation if no valid data
    const base = Math.floor(100 / assetData.length);
    let remainder = 100 - base * assetData.length;
    return assetData.map((a, index) => ({
      assetClass: a.name,
      percentage: base + (index < remainder ? 1 : 0),
    }));
  }

  // Weight by Sharpe ratio, but ensure minimum allocation
  const minAllocation = 5; // 5% minimum
  const rawAllocations = assetData.map((asset) => {
    const sharpeWeight = asset.sharpeRatio / totalSharpe;
    const baseAllocation = sharpeWeight * 100;
    return Math.max(minAllocation, baseAllocation);
  });

  const rawTotal = rawAllocations.reduce((sum, value) => sum + value, 0);
  const normalized = rawAllocations.map((value) => (value / rawTotal) * 100);
  const rounded = normalized.map((value) => Math.round(value));
  const roundedTotal = rounded.reduce((sum, value) => sum + value, 0);
  const delta = 100 - roundedTotal;

  if (delta !== 0) {
    const adjustIndex = normalized.reduce((bestIndex, value, index, list) => {
      return value > list[bestIndex] ? index : bestIndex;
    }, 0);
    rounded[adjustIndex] = Math.max(0, rounded[adjustIndex] + delta);
  }

  for (let i = 0; i < assetData.length; i++) {
    allocations.push({
      assetClass: assetData[i].name,
      percentage: rounded[i],
    });
  }

  return allocations;
}

/**
 * Get optimal asset allocation for a goal
 */
export function getOptimalAllocation(
  goal: { horizonYears: number },
  tier: "basic" | "ambitious",
  allowedAssetClasses: string[],
  assetClasses: AssetClasses,
  currentMonth: number = 0
): AssetAllocation[] {
  const timeHorizon = getTimeHorizonKey(goal.horizonYears);
  const totalMonths = goal.horizonYears * 12;

  // Get base allocation using Sharpe optimization
  const baseAllocation = optimizeSharpeRatio(
    allowedAssetClasses,
    assetClasses,
    timeHorizon
  );

  // For basic goals, apply time-based shifts
  if (tier === "basic") {
    return getTimeBasedAllocation(
      goal.horizonYears,
      currentMonth,
      totalMonths,
      baseAllocation,
      allowedAssetClasses
    );
  }

  // For ambitious goals, no time-based shifts
  return baseAllocation;
}

/**
 * Calculate weighted portfolio return and volatility for multiple asset classes
 * Uses probability-based risk metrics
 */
export function calculateWeightedMetrics(
  allocations: AssetAllocation[],
  assetClassDataMap: Record<string, AssetClassData>
): { return: number; volatility: number } {
  let weightedReturn = 0;
  let weightedProbNegative = 0;
  let weightedExpectedShortfall = 0;
  let totalWeight = 0;

  for (const allocation of allocations) {
    // Skip cash - it has no return/risk metrics
    if (allocation.assetClass === "cash") {
      continue;
    }

    const data = assetClassDataMap[allocation.assetClass];
    if (!data) continue;

    const weight = allocation.percentage / 100;
    totalWeight += weight;

    weightedReturn += (data.avgReturnPct / 100) * weight;
    weightedProbNegative += (data.probNegativeYearPct / 100) * weight;
    weightedExpectedShortfall += (data.expectedShortfallPct / 100) * weight;
  }

  // Normalize by total weight
  if (totalWeight > 0) {
    weightedReturn /= totalWeight;
    weightedProbNegative /= totalWeight;
    weightedExpectedShortfall /= totalWeight;
  }

  // Approximate volatility for envelope calculations
  const volatility = Math.abs(weightedExpectedShortfall) * Math.sqrt(
    weightedProbNegative / (1 - weightedProbNegative || 0.01)
  );

  return {
    return: weightedReturn,
    volatility,
  };
}
