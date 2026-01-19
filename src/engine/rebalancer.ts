import { CustomerProfile } from "../models/CustomerProfile";
import { Goal } from "../models/Goal";
import { AssetAllocation } from "./portfolio";
import { getTotalCorpus } from "../models/CustomerProfile";

/**
 * Rebalances the entire corpus to match the SIP allocation ratio across asset classes.
 * This ensures that corpus allocation percentages align with SIP allocation percentages.
 * 
 * @param profile - Customer profile with current corpus allocation
 * @param sipAllocations - SIP allocations by asset class with percentages
 * @returns Updated customer profile with rebalanced corpus
 */
export function rebalanceCorpusToSIPAllocation(
  profile: CustomerProfile,
  sipAllocations: AssetAllocation[]
): CustomerProfile {
  const totalCorpus = getTotalCorpus(profile);
  
  if (totalCorpus === 0) {
    return profile;
  }

  if (sipAllocations.length === 0) {
    return profile;
  }

  // Create new corpus allocation based on SIP allocation percentages
  const newCorpusByAssetClass: Record<string, number> = {};
  
  for (const allocation of sipAllocations) {
    const percentage = allocation.percentage / 100;
    newCorpusByAssetClass[allocation.assetClass] = totalCorpus * percentage;
  }

  // Handle any asset classes in current corpus that aren't in SIP allocation
  // Distribute proportionally or set to 0
  for (const assetClass of Object.keys(profile.corpus.byAssetClass)) {
    if (!newCorpusByAssetClass[assetClass]) {
      newCorpusByAssetClass[assetClass] = 0;
    }
  }

  // Normalize to ensure total matches
  const newTotal = Object.values(newCorpusByAssetClass).reduce(
    (sum, amount) => sum + amount,
    0
  );

  if (newTotal === 0) {
    return profile;
  }

  if (newTotal !== totalCorpus) {
    const adjustment = totalCorpus / newTotal;
    for (const assetClass of Object.keys(newCorpusByAssetClass)) {
      newCorpusByAssetClass[assetClass] *= adjustment;
    }
  }

  return {
    ...profile,
    corpus: {
      ...profile.corpus,
      byAssetClass: newCorpusByAssetClass,
    },
  };
}

/**
 * Gets corpus allocation percentages after rebalancing.
 * Converts absolute amounts to percentages for comparison.
 * 
 * @param profile - Customer profile with corpus allocation
 * @returns Record mapping asset class names to allocation percentages (0-100)
 */
export function getRebalancedCorpusAllocation(
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

/**
 * Optimizes corpus allocation across multiple goals based on priority and requirements.
 * Uses a greedy allocation strategy: allocates corpus to goals in priority order,
 * distributing proportionally from available corpus by asset class.
 * Uses basic tier priority for sorting (since corpus is allocated for basic tiers).
 * 
 * @param profile - Customer profile with available corpus
 * @param goals - Array of goals (should be pre-sorted by basic tier priority)
 * @param goalCorpusRequirements - Map of goal IDs to their required corpus amounts
 * @returns Map of goal IDs to their corpus allocations by asset class
 */
export function optimizeCorpusAllocation(
  profile: CustomerProfile,
  goals: Goal[],
  goalCorpusRequirements: Record<string, number> // goalId -> required corpus
): Record<string, Record<string, number>> {
  // goalId -> assetClass -> amount
  const goalAllocations: Record<string, Record<string, number>> = {};
  
  const totalCorpus = getTotalCorpus(profile);
  const corpusByAssetClass = { ...profile.corpus.byAssetClass };

  // Sort goals by basic tier priority (for corpus allocation, we use basic tier priority)
  const sortedGoals = [...goals].sort((a, b) => a.tiers.basic.priority - b.tiers.basic.priority);

  // Allocate corpus to goals based on priority and requirements
  for (const goal of sortedGoals) {
    const required = goalCorpusRequirements[goal.goalId] || 0;
    if (required <= 0) {
      goalAllocations[goal.goalId] = {};
      continue;
    }

    // Allocate proportionally from available corpus
    const goalAllocation: Record<string, number> = {};
    let allocated = 0;

    for (const [assetClass, available] of Object.entries(corpusByAssetClass)) {
      if (available <= 0 || allocated >= required) break;

      const allocation = Math.min(available, required - allocated);
      goalAllocation[assetClass] = allocation;
      corpusByAssetClass[assetClass] -= allocation;
      allocated += allocation;
    }

    goalAllocations[goal.goalId] = goalAllocation;
  }

  return goalAllocations;
}
