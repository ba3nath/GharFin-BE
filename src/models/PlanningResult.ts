import { GoalFeasibilityTable } from "./GoalFeasibilityTable";
import { SIPPlan } from "./SIPPlan";
import { SIPAllocationSchedule } from "./SIPAllocationSchedule";

/**
 * Planning result data structures
 */

export interface Method1Result {
  method: "method1";
  goalFeasibilityTable: GoalFeasibilityTable;
  sipAllocation: SIPPlan;
  sipAllocationSchedule: SIPAllocationSchedule;
  corpusAllocation: Record<string, Record<string, number>>; // goalId -> assetClass -> amount
}

/** GharFin method: Monte Carlo with zero-corpus Phase 1 then actual corpus + SIP (formerly Method 2). */
export interface GharFinResult {
  method: "gharfin";
  goalFeasibilityTable: GoalFeasibilityTable;
  sipAllocation: SIPPlan;
  sipAllocationSchedule: SIPAllocationSchedule;
  corpusAllocation: Record<string, Record<string, number>>; // goalId -> assetClass -> amount
}

/** @deprecated Use GharFinResult. Kept for backward compatibility. */
export type Method2Result = GharFinResult;

export interface Method3Result {
  method: "method3";
  goalFeasibilityTable: GoalFeasibilityTable;
  sipAllocation: SIPPlan;
  sipAllocationSchedule: SIPAllocationSchedule;
  corpusAllocation: Record<string, Record<string, number>>; // goalId -> assetClass -> amount
}

export type PlanningResult = Method1Result | GharFinResult | Method3Result;
