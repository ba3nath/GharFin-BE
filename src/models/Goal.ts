/**
 * Goal data structures
 */

export interface GoalTier {
  targetAmount: number;
  priority: number;
}

export interface Goal {
  goalId: string;
  goalName: string;
  horizonYears: number;
  amountVariancePct: number;
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
 * Get goal target amount for a tier
 */
export function getGoalTarget(goal: Goal, tier: "basic" | "ambitious"): number {
  return goal.tiers[tier].targetAmount;
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
