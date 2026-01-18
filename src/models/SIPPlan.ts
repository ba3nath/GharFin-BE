/**
 * SIP planning data structures
 */

export interface AssetAllocation {
  assetClass: string;
  percentage: number;
}

export interface GoalAssetAllocation {
  goalId: string;
  allocations: AssetAllocation[];
}

export interface SIPAllocation {
  goalId: string;
  monthlyAmount: number;
  percentage: number;
}

export interface SIPPlan {
  totalMonthlySIP: number;
  perGoalAllocations: SIPAllocation[];
  perAssetClassAllocations: AssetAllocation[];
  goalAssetAllocations: GoalAssetAllocation[];
}
