/**
 * Goal feasibility table data structures
 * Status is against the max of the range: can_be_met = projected >= max, at_risk = [min, max), cannot_be_met = < min.
 */

export type GoalStatus = "can_be_met" | "at_risk" | "cannot_be_met";

export type TargetAmountRange = [number, number];

export interface GoalFeasibilityRow {
  goalId: string;
  goalName: string;
  tier: "basic" | "ambitious";
  status: GoalStatus;
  confidencePercent: number;
  targetAmountRange: TargetAmountRange;
  projectedCorpus: {
    lower: number;
    mean: number;
    lowerDeviation?: number; // Deviation from targetAmountRange[1] (max)
    meanDeviation?: number;
  };
  portfolioProjectedCorpus?: {
    lower: number;
    mean: number;
  };
}

export interface GoalFeasibilityTable {
  rows: GoalFeasibilityRow[];
}

/**
 * Determine goal status from confidence percentage.
 * Status is against the max of the range. For "can_be_met", the lower bound must also be >= targetMax (within tolerance).
 */
export function getGoalStatus(
  confidencePercent: number,
  lowerBound?: number,
  targetMax?: number
): GoalStatus {
  const tolerance =
    targetMax !== undefined
      ? Math.min(targetMax * 0.10, 500000)
      : 0;

  if (confidencePercent >= 90) {
    if (lowerBound !== undefined && targetMax !== undefined) {
      if (lowerBound >= targetMax - tolerance) {
        return "can_be_met";
      }
      return "at_risk";
    }
    return "can_be_met";
  } else if (confidencePercent >= 50) {
    return "at_risk";
  } else {
    return "cannot_be_met";
  }
}
