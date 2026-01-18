/**
 * Goal data structures
 */

export interface GoalTier {
  targetAmount: number;
}

export interface Goal {
  goalId: string;
  goalName: string;
  priority: number;
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
 * Sort goals by priority
 */
export function sortGoalsByPriority(goals: Goal[]): Goal[] {
  return [...goals].sort((a, b) => a.priority - b.priority);
}

/**
 * Get goal target amount for a tier
 */
export function getGoalTarget(goal: Goal, tier: "basic" | "ambitious"): number {
  return goal.tiers[tier].targetAmount;
}
