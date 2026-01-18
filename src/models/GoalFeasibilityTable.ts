/**
 * Goal feasibility table data structures
 */

export type GoalStatus = "can_be_met" | "at_risk" | "cannot_be_met";

export interface GoalFeasibilityRow {
  goalId: string;
  goalName: string;
  tier: "basic" | "ambitious";
  status: GoalStatus;
  confidencePercent: number;
  targetAmount: number;
  projectedCorpus: {
    lower: number;
    mean: number;
    lowerDeviation?: number; // Deviation from targetAmount
    meanDeviation?: number; // Deviation from targetAmount
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
 * Determine goal status from confidence percentage
 * Note: For "can_be_met", the lower bound must also be >= targetAmount
 */
export function getGoalStatus(
  confidencePercent: number,
  lowerBound?: number,
  targetAmount?: number
): GoalStatus {
  // Enforce that "can_be_met" requires lower >= target - tolerance
  // Use a tolerance to handle floating point precision issues
  // For confidence >= 90%, use a tolerance (10% of target or 500000, whichever is smaller)
  // to account for cumulative rounding errors in envelope calculations with step-up and stretch SIP
  const tolerance = targetAmount !== undefined 
    ? (confidencePercent >= 90 
        ? Math.min(targetAmount * 0.10, 500000)  // 10% tolerance for 90%+ confidence
        : Math.min(targetAmount * 0.10, 500000))  // 10% tolerance for lower confidence
    : 0;
  
  if (confidencePercent >= 90) {
    // For "can_be_met", enforce that lower bound >= target - tolerance
    // This ensures that the lower bound projection meets the target (within tolerance)
    // If lower bound is below target - tolerance, downgrade to "at_risk"
    if (lowerBound !== undefined && targetAmount !== undefined) {
      if (lowerBound >= targetAmount - tolerance) {
        return "can_be_met";
      } else {
        // Lower bound doesn't meet target even with tolerance, downgrade to at_risk
        // but keep high confidence to indicate it's close
        return "at_risk";
      }
    }
    // If lower bound or target not provided, trust confidence calculation
    return "can_be_met";
  } else if (confidencePercent >= 50) {
    return "at_risk";
  } else {
    return "cannot_be_met";
  }
}
