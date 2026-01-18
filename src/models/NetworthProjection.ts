/**
 * Networth projection data structures
 */

export interface MonthlyNetworthData {
  month: number;
  totalNetworth: number;
  corpusByGoal: Record<string, number>; // goalId -> corpus value for this goal
  sipContributions: number; // cumulative SIP added up to this month
  events?: string[]; // e.g., ["goal_due:car_purchase", "step_up:12"]
}

export interface NetworthProjectionData {
  method: "method1" | "method2" | "method3";
  monthlyValues: MonthlyNetworthData[];
  maxMonth: number; // Until longest goal horizon
  metadata: {
    initialTotalCorpus: number;
    totalMonthlySIP: number;
    stepUpPercent: number;
    goals: Array<{
      goalId: string;
      goalName: string;
      horizonMonths: number;
      basicTierCorpus: number;
      confidencePercent?: number;
      status?: "can_be_met" | "at_risk" | "cannot_be_met";
    }>;
  };
}
