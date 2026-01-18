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

export interface Method2Result {
  method: "method2";
  goalFeasibilityTable: GoalFeasibilityTable;
  sipAllocation: SIPPlan;
  sipAllocationSchedule: SIPAllocationSchedule;
  corpusAllocation: Record<string, Record<string, number>>; // goalId -> assetClass -> amount
}

export interface Method3Result {
  method: "method3";
  goalFeasibilityTable: GoalFeasibilityTable;
  sipAllocation: SIPPlan;
  sipAllocationSchedule: SIPAllocationSchedule;
  corpusAllocation: Record<string, Record<string, number>>; // goalId -> assetClass -> amount
}

export type PlanningResult = Method1Result | Method2Result | Method3Result;
