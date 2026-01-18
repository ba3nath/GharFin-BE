/**
 * Customer profile data structure
 */

export interface CustomerProfile {
  asOfDate: string;
  totalNetWorth: number;
  corpus: {
    byAssetClass: Record<string, number>;
    allowedAssetClasses: string[];
  };
}

/**
 * Get total corpus amount
 */
export function getTotalCorpus(profile: CustomerProfile): number {
  return Object.values(profile.corpus.byAssetClass).reduce(
    (sum, amount) => sum + amount,
    0
  );
}

/**
 * Get corpus allocation percentage for each asset class
 */
export function getCorpusAllocationPercentages(
  profile: CustomerProfile
): Record<string, number> {
  const total = getTotalCorpus(profile);
  if (total === 0) {
    return {};
  }

  const percentages: Record<string, number> = {};
  for (const [assetClass, amount] of Object.entries(profile.corpus.byAssetClass)) {
    percentages[assetClass] = Math.round((amount / total) * 100);
  }
  return percentages;
}
