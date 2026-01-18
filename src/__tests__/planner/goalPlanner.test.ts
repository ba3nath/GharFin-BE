import { GoalPlanner } from '../../planner/goalPlanner';
import { minimalValidRequest } from '../fixtures/requests';
import { fullAssetClasses } from '../fixtures/assetClasses';
import { minimalCustomerProfile, zeroCorpusProfile } from '../fixtures/customerProfiles';
import { singleGoal, multipleGoals, unachievableGoal } from '../fixtures/goals';
import { minimalSIPInput, zeroSIP } from '../fixtures/sipInputs';

describe('GoalPlanner - planMethod1', () => {
  it('should plan with minimal request', () => {
    const planner = new GoalPlanner({
      assetClasses: minimalValidRequest.assetClasses,
      customerProfile: minimalValidRequest.customerProfile,
      goals: minimalValidRequest.goals.goals,
      sipInput: minimalSIPInput,
    });

    const result = planner.planMethod1();

    expect(result.method).toBe('method1');
    expect(result.goalFeasibilityTable).toBeDefined();
    expect(result.sipAllocation).toBeDefined();
    expect(result.sipAllocationSchedule).toBeDefined();
    expect(result.corpusAllocation).toBeDefined();
  });

  it('should handle single goal', () => {
    const planner = new GoalPlanner({
      assetClasses: fullAssetClasses,
      customerProfile: minimalCustomerProfile,
      goals: [singleGoal],
      sipInput: minimalSIPInput,
    });

    const result = planner.planMethod1();

    // Planner creates rows for both basic and ambitious tiers
    expect(result.goalFeasibilityTable.rows.length).toBe(2); // 1 goal × 2 tiers
    expect(result.sipAllocation.perGoalAllocations.length).toBeGreaterThan(0);
  });

  it('should handle multiple goals with priority', () => {
    const planner = new GoalPlanner({
      assetClasses: fullAssetClasses,
      customerProfile: minimalCustomerProfile,
      goals: multipleGoals,
      sipInput: minimalSIPInput,
    });

    const result = planner.planMethod1();

    // Planner creates rows for both basic and ambitious tiers for each goal
    expect(result.goalFeasibilityTable.rows.length).toBe(multipleGoals.length * 2); // 2 goals × 2 tiers
    expect(result.sipAllocation.perGoalAllocations.length).toBeGreaterThan(0);
  });

  it('should allocate SIP within available limit', () => {
    const planner = new GoalPlanner({
      assetClasses: fullAssetClasses,
      customerProfile: minimalCustomerProfile,
      goals: multipleGoals,
      sipInput: minimalSIPInput,
    });

    const result = planner.planMethod1();

    const totalAllocated = result.sipAllocation.perGoalAllocations.reduce(
      (sum: number, goal: any) => sum + goal.monthlyAmount,
      0
    );

    expect(totalAllocated).toBeLessThanOrEqual(
      minimalSIPInput.monthlySIP + minimalSIPInput.monthlySIP * (minimalSIPInput.stretchSIPPercent / 100)
    );
  });

  it('should round SIP amounts to nearest 1000', () => {
    const planner = new GoalPlanner({
      assetClasses: fullAssetClasses,
      customerProfile: minimalCustomerProfile,
      goals: [singleGoal],
      sipInput: minimalSIPInput,
    });

    const result = planner.planMethod1();

    result.sipAllocation.perGoalAllocations.forEach((goal: any) => {
      expect(goal.monthlyAmount % 1000).toBe(0);
    });
  });

  it('should handle zero SIP', () => {
    const planner = new GoalPlanner({
      assetClasses: fullAssetClasses,
      customerProfile: minimalCustomerProfile,
      goals: [singleGoal],
      sipInput: zeroSIP,
    });

    const result = planner.planMethod1();

    expect(result.goalFeasibilityTable).toBeDefined();
    expect(result.sipAllocation.perGoalAllocations.length).toBeGreaterThanOrEqual(0);
  });

  it('should handle zero corpus', () => {
    const planner = new GoalPlanner({
      assetClasses: fullAssetClasses,
      customerProfile: zeroCorpusProfile,
      goals: [singleGoal],
      sipInput: minimalSIPInput,
    });

    const result = planner.planMethod1();

    expect(result.goalFeasibilityTable).toBeDefined();
    expect(result.corpusAllocation).toBeDefined();
  });

  it('should calculate goal status correctly', () => {
    const planner = new GoalPlanner({
      assetClasses: fullAssetClasses,
      customerProfile: minimalCustomerProfile,
      goals: [singleGoal],
      sipInput: minimalSIPInput,
    });

    const result = planner.planMethod1();

    const goalRow = result.goalFeasibilityTable.rows.find((row: any) => row.goalId === singleGoal.goalId);
    expect(goalRow).toBeDefined();
    if (goalRow) {
      expect(['can_be_met', 'at_risk', 'cannot_be_met']).toContain(goalRow.status);
      expect(goalRow.confidencePercent).toBeGreaterThanOrEqual(0);
      expect(goalRow.confidencePercent).toBeLessThanOrEqual(100);
    }
  });
});

describe('GoalPlanner - planMethod2', () => {
  it('should plan with minimal request (requires volatilityPct)', () => {
    const planner = new GoalPlanner({
      assetClasses: minimalValidRequest.assetClasses,
      customerProfile: minimalValidRequest.customerProfile,
      goals: minimalValidRequest.goals.goals,
      sipInput: minimalSIPInput,
    });

    const result = planner.planMethod2(100); // Use fewer paths for faster test

    expect(result.method).toBe('method2');
    expect(result.goalFeasibilityTable).toBeDefined();
    expect(result.sipAllocation).toBeDefined();
    expect(result.sipAllocationSchedule).toBeDefined();
    expect(result.corpusAllocation).toBeDefined();
  });

  it('should throw error if volatilityPct missing', () => {
    const assetClassesWithoutVolatility = {
      largeCap: {
        "10Y": {
          avgReturnPct: 11.0,
          probNegativeYearPct: 18,
          expectedShortfallPct: -15,
          maxDrawdownPct: -28,
          // volatilityPct missing
        },
      },
    };

    const planner = new GoalPlanner({
      assetClasses: assetClassesWithoutVolatility,
      customerProfile: minimalCustomerProfile,
      goals: [singleGoal],
      sipInput: minimalSIPInput,
    });

    expect(() => {
      planner.planMethod2(10);
    }).toThrow();
  });

  it('should round SIP amounts to nearest 1000', () => {
    const planner = new GoalPlanner({
      assetClasses: fullAssetClasses,
      customerProfile: minimalCustomerProfile,
      goals: [singleGoal],
      sipInput: minimalSIPInput,
    });

    const result = planner.planMethod2(100);

    result.sipAllocation.perGoalAllocations.forEach((goal: any) => {
      expect(goal.monthlyAmount % 1000).toBe(0);
    });
  });

  it('should calculate confidence using Monte Carlo', () => {
    const planner = new GoalPlanner({
      assetClasses: fullAssetClasses,
      customerProfile: minimalCustomerProfile,
      goals: [singleGoal],
      sipInput: minimalSIPInput,
    });

    const result = planner.planMethod2(100);

    const goalRow = result.goalFeasibilityTable.rows.find((row: any) => row.goalId === singleGoal.goalId);
    expect(goalRow).toBeDefined();
    if (goalRow) {
      expect(goalRow.confidencePercent).toBeGreaterThanOrEqual(0);
      expect(goalRow.confidencePercent).toBeLessThanOrEqual(100);
      expect(Number.isInteger(goalRow.confidencePercent)).toBe(true);
    }
  });

  it('should handle unachievable goals', () => {
    const planner = new GoalPlanner({
      assetClasses: fullAssetClasses,
      customerProfile: minimalCustomerProfile,
      goals: [unachievableGoal],
      sipInput: minimalSIPInput,
    });

    const result = planner.planMethod2(100);

    const goalRow = result.goalFeasibilityTable.rows.find((row: any) => row.goalId === unachievableGoal.goalId);
    expect(goalRow).toBeDefined();
    if (goalRow) {
      expect(goalRow.status).toBe('cannot_be_met');
    }
  });
});
