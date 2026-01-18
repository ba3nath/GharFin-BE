/**
 * Asset class data structure
 */

export interface AssetClassData {
  avgReturnPct: number;
  probNegativeYearPct: number; // % of years expected to be negative (risk)
  expectedShortfallPct: number; // CVaR - Average loss given that a bad year happens (how ugly bad years are)
  maxDrawdownPct: number; // Peak-to-trough loss in a crisis cycle (used for protection logic)
  volatilityPct?: number; // Annual volatility % (required for Method 2, optional for Method 1)
}

export interface TimeHorizonData {
  "3Y"?: AssetClassData;
  "5Y"?: AssetClassData;
  "10Y"?: AssetClassData;
}

export type AssetClasses = Record<string, TimeHorizonData>;

/**
 * Get asset class data for a specific time horizon
 */
export function getAssetClassData(
  assetClasses: AssetClasses,
  assetClassName: string,
  timeHorizon: "3Y" | "5Y" | "10Y"
): AssetClassData | null {
  const assetClass = assetClasses[assetClassName];
  if (!assetClass) {
    return null;
  }
  return assetClass[timeHorizon] || null;
}

/**
 * Calculate average positive year return given average return, probability of negative years, and expected shortfall
 * 
 * avgReturn = probNegative * expectedShortfall + (1 - probNegative) * avgPositiveReturn
 * Solving for avgPositiveReturn:
 * avgPositiveReturn = (avgReturn - probNegative * expectedShortfall) / (1 - probNegative)
 */
export function calculateAvgPositiveReturn(data: AssetClassData): number {
  const probNegative = data.probNegativeYearPct / 100;
  const avgReturn = data.avgReturnPct / 100;
  const expectedShortfall = data.expectedShortfallPct / 100; // Already negative
  
  if (probNegative >= 1) {
    // All years are negative
    return expectedShortfall;
  }
  
  if (probNegative === 0) {
    // No negative years
    return avgReturn;
  }
  
  return (avgReturn - probNegative * expectedShortfall) / (1 - probNegative);
}
