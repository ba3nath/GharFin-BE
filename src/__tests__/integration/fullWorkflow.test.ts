import { GoalPlanner } from '../../planner/goalPlanner';
import { minimalValidRequest } from '../fixtures/requests';
import { minimalSIPInput } from '../fixtures/sipInputs';

describe('Full Method 1 Workflow', () => {
  it('should complete full planning workflow', () => {
    const planner = new GoalPlanner({
      assetClasses: minimalValidRequest.assetClasses,
      customerProfile: minimalValidRequest.customerProfile,
      goals: minimalValidRequest.goals.goals,
      sipInput: minimalSIPInput,
    });

    const result = planner.planMethod1();

    // Verify all outputs present
    expect(result.method).toBe('method1');
    expect(result.goalFeasibilityTable).toBeDefined();
    expect(result.sipAllocation).toBeDefined();
    expect(result.sipAllocationSchedule).toBeDefined();
    expect(result.corpusAllocation).toBeDefined();

    // Verify feasibility table structure
    expect(Array.isArray(result.goalFeasibilityTable.rows)).toBe(true);
    result.goalFeasibilityTable.rows.forEach((row: any) => {
      expect(row.goalId).toBeDefined();
      expect(row.status).toBeDefined();
      expect(['can_be_met', 'at_risk', 'cannot_be_met']).toContain(row.status);
      expect(row.confidencePercent).toBeGreaterThanOrEqual(0);
      expect(row.confidencePercent).toBeLessThanOrEqual(100);
      expect(Number.isInteger(row.confidencePercent)).toBe(true);
    });

    // Verify SIP allocation structure
    expect(Array.isArray(result.sipAllocation.perGoalAllocations)).toBe(true);
    result.sipAllocation.perGoalAllocations.forEach((goal: any) => {
      expect(goal.goalId).toBeDefined();
      expect(goal.monthlyAmount).toBeGreaterThanOrEqual(0);
      expect(goal.monthlyAmount % 1000).toBe(0); // Rounded to nearest 1000
      expect(goal.percentage).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(goal.percentage)).toBe(true); // Rounded to 0 decimals
    });
  });

  it('should verify data consistency - SIP allocation sums correctly', () => {
    const planner = new GoalPlanner({
      assetClasses: minimalValidRequest.assetClasses,
      customerProfile: minimalValidRequest.customerProfile,
      goals: minimalValidRequest.goals.goals,
      sipInput: minimalSIPInput,
    });

    const result = planner.planMethod1();

    const totalAllocated = result.sipAllocation.perGoalAllocations.reduce(
      (sum: number, goal: any) => sum + goal.monthlyAmount,
      0
    );

    const availableSIP = minimalSIPInput.monthlySIP;
    expect(totalAllocated).toBeLessThanOrEqual(availableSIP);
  });

  it('should verify corpus allocation sums correctly', () => {
    const planner = new GoalPlanner({
      assetClasses: minimalValidRequest.assetClasses,
      customerProfile: minimalValidRequest.customerProfile,
      goals: minimalValidRequest.goals.goals,
      sipInput: minimalSIPInput,
    });

    const result = planner.planMethod1();

    let totalAllocated = 0;
    for (const goalAlloc of Object.values(result.corpusAllocation)) {
      const goalTotal = Object.values(goalAlloc).reduce((sum, v) => sum + v, 0);
      totalAllocated += goalTotal;
    }

    const originalTotal = Object.values(minimalValidRequest.customerProfile.corpus.byAssetClass).reduce(
      (sum, v) => sum + v,
      0
    );

    expect(totalAllocated).toBeLessThanOrEqual(originalTotal);
  });

  it('should verify rounding applied throughout', () => {
    const planner = new GoalPlanner({
      assetClasses: minimalValidRequest.assetClasses,
      customerProfile: minimalValidRequest.customerProfile,
      goals: minimalValidRequest.goals.goals,
      sipInput: minimalSIPInput,
    });

    const result = planner.planMethod1();

    // Verify SIP rounding
    result.sipAllocation.perGoalAllocations.forEach((goal: any) => {
      expect(goal.monthlyAmount % 1000).toBe(0);
      expect(Number.isInteger(goal.percentage)).toBe(true);
    });

    // Verify confidence rounding
    result.goalFeasibilityTable.rows.forEach((row: any) => {
      expect(Number.isInteger(row.confidencePercent)).toBe(true);
    });

    // Verify corpus rounding (should be rounded to nearest 1000)
    for (const goalAlloc of Object.values(result.corpusAllocation)) {
      for (const amount of Object.values(goalAlloc)) {
        expect(amount % 1000).toBe(0);
      }
    }
  });
});

describe('Full Method 2 Workflow', () => {
  it('should complete full planning workflow', () => {
    const planner = new GoalPlanner({
      assetClasses: minimalValidRequest.assetClasses,
      customerProfile: minimalValidRequest.customerProfile,
      goals: minimalValidRequest.goals.goals,
      sipInput: minimalSIPInput,
    });

    const result = planner.planMethod2(100); // Use fewer paths for faster test

    // Verify all outputs present
    expect(result.method).toBe('method2');
    expect(result.goalFeasibilityTable).toBeDefined();
    expect(result.sipAllocation).toBeDefined();
    expect(result.sipAllocationSchedule).toBeDefined();
    expect(result.corpusAllocation).toBeDefined();

    // Verify Monte Carlo results structure
    expect(Array.isArray(result.goalFeasibilityTable.rows)).toBe(true);
    result.goalFeasibilityTable.rows.forEach((row: any) => {
      expect(row.goalId).toBeDefined();
      expect(row.status).toBeDefined();
      expect(row.confidencePercent).toBeGreaterThanOrEqual(0);
      expect(row.confidencePercent).toBeLessThanOrEqual(100);
      expect(Number.isInteger(row.confidencePercent)).toBe(true);
    });
  });

  it('should verify Monte Carlo results', () => {
    const planner = new GoalPlanner({
      assetClasses: minimalValidRequest.assetClasses,
      customerProfile: minimalValidRequest.customerProfile,
      goals: minimalValidRequest.goals.goals,
      sipInput: minimalSIPInput,
    });

    const result = planner.planMethod2(100);

    // Verify bounds are reasonable
    result.goalFeasibilityTable.rows.forEach((row: any) => {
      expect(row.projectedCorpus.lower).toBeGreaterThanOrEqual(0);
      expect(row.projectedCorpus.mean).toBeGreaterThanOrEqual(0);
      expect(row.projectedCorpus.lower).toBeLessThanOrEqual(row.projectedCorpus.mean);
    });
  });

  it('should verify data consistency', () => {
    const planner = new GoalPlanner({
      assetClasses: minimalValidRequest.assetClasses,
      customerProfile: minimalValidRequest.customerProfile,
      goals: minimalValidRequest.goals.goals,
      sipInput: minimalSIPInput,
    });

    const result = planner.planMethod2(100);

    // Verify SIP allocation sums
    const totalAllocated = result.sipAllocation.perGoalAllocations.reduce(
      (sum: number, goal: any) => sum + goal.monthlyAmount,
      0
    );

    const availableSIP = minimalSIPInput.monthlySIP;
    expect(totalAllocated).toBeLessThanOrEqual(availableSIP);
  });
});

describe('Method Comparison', () => {
  it('should produce valid outputs from both methods', () => {
    const planner = new GoalPlanner({
      assetClasses: minimalValidRequest.assetClasses,
      customerProfile: minimalValidRequest.customerProfile,
      goals: minimalValidRequest.goals.goals,
      sipInput: minimalSIPInput,
    });

    const method1Result = planner.planMethod1();
    const method2Result = planner.planMethod2(100);

    // Both should have same structure
    expect(method1Result.method).toBe('method1');
    expect(method2Result.method).toBe('method2');

    // Both should have feasibility tables with at least one row per goal (basic tier always present)
    const goalCount = minimalValidRequest.goals.goals.length;
    expect(method1Result.goalFeasibilityTable.rows.length).toBeGreaterThanOrEqual(goalCount);
    expect(method2Result.goalFeasibilityTable.rows.length).toBeGreaterThanOrEqual(goalCount);
    // Row count can differ: Method 1 may only include basic tier when ambitious confidence < 90%; Method 2 may include both tiers
    expect(method1Result.goalFeasibilityTable.rows.length).toBeLessThanOrEqual(goalCount * 2);
    expect(method2Result.goalFeasibilityTable.rows.length).toBeLessThanOrEqual(goalCount * 2);

    // Both should have SIP allocations
    expect(method1Result.sipAllocation.perGoalAllocations.length).toBeGreaterThan(0);
    expect(method2Result.sipAllocation.perGoalAllocations.length).toBeGreaterThan(0);
  });

  it('should verify consistency in goal status', () => {
    const planner = new GoalPlanner({
      assetClasses: minimalValidRequest.assetClasses,
      customerProfile: minimalValidRequest.customerProfile,
      goals: minimalValidRequest.goals.goals,
      sipInput: minimalSIPInput,
    });

    const method1Result = planner.planMethod1();
    const method2Result = planner.planMethod2(100);

    // Both should have status for all goals
    method1Result.goalFeasibilityTable.rows.forEach((row1: any) => {
      const row2 = method2Result.goalFeasibilityTable.rows.find((r: any) => r.goalId === row1.goalId);
      expect(row2).toBeDefined();
      if (row2) {
        expect(['can_be_met', 'at_risk', 'cannot_be_met']).toContain(row2.status);
      }
    });
  });
});
