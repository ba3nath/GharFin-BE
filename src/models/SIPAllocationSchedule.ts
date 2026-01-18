/**
 * SIP allocation schedule data structures
 */

export interface SIPAllocationSnapshot {
  month: number;
  perGoalAllocations: Record<string, number>; // goalId -> percentage
  perAssetClassAllocations: Record<string, number>; // assetClass -> percentage
  changeReason?: string; // e.g., "time_based_shift", "goal_completion", "step_up"
}

export interface SIPAllocationSchedule {
  snapshots: SIPAllocationSnapshot[];
}

/**
 * Create initial snapshot
 */
export function createInitialSnapshot(
  perGoalAllocations: Record<string, number>,
  perAssetClassAllocations: Record<string, number>
): SIPAllocationSnapshot {
  return {
    month: 0,
    perGoalAllocations,
    perAssetClassAllocations,
  };
}
