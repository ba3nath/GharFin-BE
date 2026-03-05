import type { ProfileType } from "./AssetsConfig";

/**
 * Goal data structures
 * targetAmount is [min, max] range; strict ordering required (max > min).
 */

export type TargetAmountRange = [number, number];

export interface GoalTier {
  targetAmount: TargetAmountRange;
  priority: number;
}

export interface Goal {
  goalId: string;
  goalName: string;
  horizonYears: number;
  /**
   * Return/volatility assumption for this goal: conservative (lower return, higher vol),
   * realistic (mid), aggressive (higher return, lower vol). Default conservative.
   * Affects which assets are applicable and required corpus/SIP when using assets config.
   */
  profile_type?: ProfileType;
  tiers: {
    basic: GoalTier;
    ambitious: GoalTier;
  };
}

export interface Goals {
  goals: Goal[];
}

/**
 * Get tier priority for a goal
 */
export function getTierPriority(goal: Goal, tier: "basic" | "ambitious"): number {
  return goal.tiers[tier].priority;
}

/**
 * Get goal target amount for a tier (max of range). Use for SIP/corpus planning.
 */
export function getGoalTarget(goal: Goal, tier: "basic" | "ambitious"): number {
  return goal.tiers[tier].targetAmount[1];
}

/**
 * Get minimum of goal target range for a tier.
 */
export function getGoalTargetMin(goal: Goal, tier: "basic" | "ambitious"): number {
  return goal.tiers[tier].targetAmount[0];
}

/**
 * Get maximum of goal target range for a tier.
 */
export function getGoalTargetMax(goal: Goal, tier: "basic" | "ambitious"): number {
  return goal.tiers[tier].targetAmount[1];
}

/**
 * Sort goals by basic tier priority
 */
export function getBasicTiersSorted(goals: Goal[]): Goal[] {
  return [...goals].sort((a, b) => a.tiers.basic.priority - b.tiers.basic.priority);
}

/**
 * Sort goals by ambitious tier priority
 */
export function getAmbitiousTiersSorted(goals: Goal[]): Goal[] {
  return [...goals].sort((a, b) => a.tiers.ambitious.priority - b.tiers.ambitious.priority);
}

/**
 * Get all tiers (basic and ambitious) flattened and sorted by priority
 * Returns array of {goal, tier, priority} sorted by priority ascending
 */
export function getAllTiersSorted(
  goals: Goal[]
): Array<{ goal: Goal; tier: "basic" | "ambitious"; priority: number }> {
  const allTiers: Array<{ goal: Goal; tier: "basic" | "ambitious"; priority: number }> = [];
  
  for (const goal of goals) {
    allTiers.push({
      goal,
      tier: "basic",
      priority: goal.tiers.basic.priority,
    });
    allTiers.push({
      goal,
      tier: "ambitious",
      priority: goal.tiers.ambitious.priority,
    });
  }
  
  return allTiers.sort((a, b) => a.priority - b.priority);
}

/**
 * @deprecated Use getBasicTiersSorted() or getAmbitiousTiersSorted() instead
 * Sort goals by priority (for backward compatibility - uses basic tier priority)
 */
export function sortGoalsByPriority(goals: Goal[]): Goal[] {
  return getBasicTiersSorted(goals);
}
