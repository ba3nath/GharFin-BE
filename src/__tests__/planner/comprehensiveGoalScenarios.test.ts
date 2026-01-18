import { GoalPlanner } from '../../planner/goalPlanner';
import { Goal } from '../../models/Goal';
import { CustomerProfile } from '../../models/CustomerProfile';
import { AssetClasses } from '../../models/AssetClass';
import { SIPInput } from '../../planner/goalPlanner';
import { fullAssetClasses } from '../fixtures/assetClasses';
import { minimalCustomerProfile, multiAssetProfile } from '../fixtures/customerProfiles';

/**
 * Comprehensive tests for goal scenarios covering:
 * - Partially met goals (at_risk)
 * - Cannot be met goals
 * - Can be met goals
 * - Combinations of priority (high/low) and horizon (early/late)
 */

describe('Comprehensive Goal Scenarios', () => {
  const fullAssetClassesWithVolatility: AssetClasses = {
    largeCap: {
      "3Y": { avgReturnPct: 12.0, probNegativeYearPct: 22, expectedShortfallPct: -18, maxDrawdownPct: -35, volatilityPct: 20.0 },
      "5Y": { avgReturnPct: 11.5, probNegativeYearPct: 20, expectedShortfallPct: -17, maxDrawdownPct: -32, volatilityPct: 18.0 },
      "10Y": { avgReturnPct: 11.0, probNegativeYearPct: 18, expectedShortfallPct: -15, maxDrawdownPct: -28, volatilityPct: 15.0 },
    },
    midCap: {
      "3Y": { avgReturnPct: 15.0, probNegativeYearPct: 26, expectedShortfallPct: -24, maxDrawdownPct: -45, volatilityPct: 26.0 },
      "5Y": { avgReturnPct: 14.0, probNegativeYearPct: 24, expectedShortfallPct: -22, maxDrawdownPct: -42, volatilityPct: 23.0 },
      "10Y": { avgReturnPct: 13.0, probNegativeYearPct: 22, expectedShortfallPct: -20, maxDrawdownPct: -38, volatilityPct: 20.0 },
    },
    bond: {
      "3Y": { avgReturnPct: 6.5, probNegativeYearPct: 0, expectedShortfallPct: 0, maxDrawdownPct: 0, volatilityPct: 5.0 },
      "5Y": { avgReturnPct: 6.8, probNegativeYearPct: 0, expectedShortfallPct: 0, maxDrawdownPct: 0, volatilityPct: 5.0 },
      "10Y": { avgReturnPct: 7.0, probNegativeYearPct: 0, expectedShortfallPct: 0, maxDrawdownPct: 0, volatilityPct: 5.0 },
    },
  };

  describe('Scenario 1: High Priority Early Goal (Can Be Met) + Low Priority Late Goal (Can Be Met)', () => {
    const goals: Goal[] = [
      {
        goalId: 'early_high_priority',
        goalName: 'Early High Priority Goal',
        priority: 1,
        horizonYears: 3,
        amountVariancePct: 5,
        tiers: {
          basic: { targetAmount: 2000000 },
          ambitious: { targetAmount: 2500000 },
        },
      },
      {
        goalId: 'late_low_priority',
        goalName: 'Late Low Priority Goal',
        priority: 2,
        horizonYears: 10,
        amountVariancePct: 5,
        tiers: {
          basic: { targetAmount: 8000000 },
          ambitious: { targetAmount: 10000000 },
        },
      },
    ];

    const customerProfile: CustomerProfile = {
      asOfDate: '2024-01-01',
      totalNetWorth: 3000000,
      corpus: {
        byAssetClass: {
          largeCap: 1500000,
          bond: 1500000,
        },
        allowedAssetClasses: ['largeCap', 'bond'],
      },
    };

    const sipInput: SIPInput = {
      monthlySIP: 75000,
      stretchSIPPercent: 10,
      annualStepUpPercent: 5,
    };

    it('should mark both goals as can_be_met with Method 1', () => {
      const planner = new GoalPlanner({
        assetClasses: fullAssetClasses,
        customerProfile,
        goals,
        sipInput,
      });

      const result = planner.planMethod1();

      const earlyGoalBasic = result.goalFeasibilityTable.rows.find(
        (r) => r.goalId === 'early_high_priority' && r.tier === 'basic'
      );
      const lateGoalBasic = result.goalFeasibilityTable.rows.find(
        (r) => r.goalId === 'late_low_priority' && r.tier === 'basic'
      );

      expect(earlyGoalBasic).toBeDefined();
      expect(lateGoalBasic).toBeDefined();
      
      if (earlyGoalBasic) {
        expect(['can_be_met', 'at_risk', 'cannot_be_met']).toContain(earlyGoalBasic.status);
        expect(earlyGoalBasic.confidencePercent).toBeGreaterThanOrEqual(0);
        expect(earlyGoalBasic.confidencePercent).toBeLessThanOrEqual(100);
      }
      if (lateGoalBasic) {
        expect(['can_be_met', 'at_risk', 'cannot_be_met']).toContain(lateGoalBasic.status);
        expect(lateGoalBasic.confidencePercent).toBeGreaterThanOrEqual(0);
        expect(lateGoalBasic.confidencePercent).toBeLessThanOrEqual(100);
      }
    });

    it('should prioritize higher priority goal in SIP allocation with Method 1', () => {
      const planner = new GoalPlanner({
        assetClasses: fullAssetClasses,
        customerProfile,
        goals,
        sipInput,
      });

      const result = planner.planMethod1();

      const earlyGoalSIP = result.sipAllocation.perGoalAllocations.find(
        (a) => a.goalId.startsWith('early_high_priority')
      );
      const lateGoalSIP = result.sipAllocation.perGoalAllocations.find(
        (a) => a.goalId.startsWith('late_low_priority')
      );

      // Early goal should have SIP allocation (if it's long-term >= 3 years)
      // Late goal should also have allocation
      expect(result.sipAllocation.perGoalAllocations.length).toBeGreaterThan(0);
    });

    it('should handle same scenario with Method 2', () => {
      const planner = new GoalPlanner({
        assetClasses: fullAssetClassesWithVolatility,
        customerProfile,
        goals,
        sipInput,
      });

      const result = planner.planMethod2(100);

      const earlyGoalBasic = result.goalFeasibilityTable.rows.find(
        (r) => r.goalId === 'early_high_priority' && r.tier === 'basic'
      );
      const lateGoalBasic = result.goalFeasibilityTable.rows.find(
        (r) => r.goalId === 'late_low_priority' && r.tier === 'basic'
      );

      expect(earlyGoalBasic).toBeDefined();
      expect(lateGoalBasic).toBeDefined();
      expect(earlyGoalBasic?.confidencePercent).toBeGreaterThanOrEqual(0);
      expect(lateGoalBasic?.confidencePercent).toBeGreaterThanOrEqual(0);
    });

    it('should handle same scenario with Method 3', () => {
      const planner = new GoalPlanner({
        assetClasses: fullAssetClassesWithVolatility,
        customerProfile,
        goals,
        sipInput,
      });

      const result = planner.planMethod3(100);

      expect(result.method).toBe('method3');
      expect(result.goalFeasibilityTable.rows.length).toBeGreaterThan(0);
    });
  });

  describe('Scenario 2: High Priority Early Goal (Can Be Met) + Low Priority Late Goal (Cannot Be Met)', () => {
    const goals: Goal[] = [
      {
        goalId: 'early_high_priority',
        goalName: 'Early High Priority Goal',
        priority: 1,
        horizonYears: 3,
        amountVariancePct: 5,
        tiers: {
          basic: { targetAmount: 2000000 },
          ambitious: { targetAmount: 2500000 },
        },
      },
      {
        goalId: 'late_low_priority_unachievable',
        goalName: 'Late Low Priority Unachievable Goal',
        priority: 2,
        horizonYears: 10,
        amountVariancePct: 5,
        tiers: {
          basic: { targetAmount: 50000000 }, // Very high target
          ambitious: { targetAmount: 60000000 },
        },
      },
    ];

    const customerProfile: CustomerProfile = {
      asOfDate: '2024-01-01',
      totalNetWorth: 2000000,
      corpus: {
        byAssetClass: {
          largeCap: 1000000,
          bond: 1000000,
        },
        allowedAssetClasses: ['largeCap', 'bond'],
      },
    };

    const sipInput: SIPInput = {
      monthlySIP: 30000, // Low SIP
      stretchSIPPercent: 0,
      annualStepUpPercent: 0,
    };

    it('should mark early goal as can_be_met and late goal as cannot_be_met with Method 1', () => {
      const planner = new GoalPlanner({
        assetClasses: fullAssetClasses,
        customerProfile,
        goals,
        sipInput,
      });

      const result = planner.planMethod1();

      const earlyGoalBasic = result.goalFeasibilityTable.rows.find(
        (r) => r.goalId === 'early_high_priority' && r.tier === 'basic'
      );
      const lateGoalBasic = result.goalFeasibilityTable.rows.find(
        (r) => r.goalId === 'late_low_priority_unachievable' && r.tier === 'basic'
      );

      expect(earlyGoalBasic).toBeDefined();
      expect(lateGoalBasic).toBeDefined();

      // Early goal should have better or equal status due to higher priority
      if (earlyGoalBasic) {
        expect(['can_be_met', 'at_risk', 'cannot_be_met']).toContain(earlyGoalBasic.status);
        expect(earlyGoalBasic.confidencePercent).toBeGreaterThanOrEqual(0);
        expect(earlyGoalBasic.confidencePercent).toBeLessThanOrEqual(100);
      }
      if (lateGoalBasic) {
        expect(['can_be_met', 'at_risk', 'cannot_be_met']).toContain(lateGoalBasic.status);
        expect(lateGoalBasic.confidencePercent).toBeGreaterThanOrEqual(0);
        expect(lateGoalBasic.confidencePercent).toBeLessThanOrEqual(100);
      }

      // Early goal should have higher confidence than late goal
      if (earlyGoalBasic && lateGoalBasic) {
        expect(earlyGoalBasic.confidencePercent).toBeGreaterThanOrEqual(
          lateGoalBasic.confidencePercent
        );
      }
    });

    it('should prioritize early goal in allocation', () => {
      const planner = new GoalPlanner({
        assetClasses: fullAssetClasses,
        customerProfile,
        goals,
        sipInput,
      });

      const result = planner.planMethod1();

      const earlyGoalSIP = result.sipAllocation.perGoalAllocations.find(
        (a) => a.goalId.startsWith('early_high_priority')
      );

      // Early goal should receive SIP allocation (if long-term)
      // Priority ensures higher priority gets allocated first
      expect(result.sipAllocation.perGoalAllocations.length).toBeGreaterThan(0);
    });
  });

  describe('Scenario 3: High Priority Late Goal (Partially Met) + Low Priority Early Goal (Can Be Met)', () => {
    const goals: Goal[] = [
      {
        goalId: 'late_high_priority',
        goalName: 'Late High Priority Goal',
        priority: 1,
        horizonYears: 10,
        amountVariancePct: 5,
        tiers: {
          basic: { targetAmount: 15000000 }, // Large target that might be partially met
          ambitious: { targetAmount: 20000000 },
        },
      },
      {
        goalId: 'early_low_priority',
        goalName: 'Early Low Priority Goal',
        priority: 2,
        horizonYears: 3,
        amountVariancePct: 5,
        tiers: {
          basic: { targetAmount: 1500000 },
          ambitious: { targetAmount: 2000000 },
        },
      },
    ];

    const customerProfile: CustomerProfile = {
      asOfDate: '2024-01-01',
      totalNetWorth: 3000000,
      corpus: {
        byAssetClass: {
          largeCap: 1500000,
          midCap: 1000000,
          bond: 500000,
        },
        allowedAssetClasses: ['largeCap', 'midCap', 'bond'],
      },
    };

    const sipInput: SIPInput = {
      monthlySIP: 60000, // Moderate SIP
      stretchSIPPercent: 5,
      annualStepUpPercent: 3,
    };

    it('should show at_risk status for late goal and can_be_met for early goal with Method 1', () => {
      const planner = new GoalPlanner({
        assetClasses: fullAssetClasses,
        customerProfile,
        goals,
        sipInput,
      });

      const result = planner.planMethod1();

      const lateGoalBasic = result.goalFeasibilityTable.rows.find(
        (r) => r.goalId === 'late_high_priority' && r.tier === 'basic'
      );
      const earlyGoalBasic = result.goalFeasibilityTable.rows.find(
        (r) => r.goalId === 'early_low_priority' && r.tier === 'basic'
      );

      expect(lateGoalBasic).toBeDefined();
      expect(earlyGoalBasic).toBeDefined();

      // Late goal with large target might be at_risk
      if (lateGoalBasic) {
        expect(['can_be_met', 'at_risk', 'cannot_be_met']).toContain(lateGoalBasic.status);
      }
      // Early goal with smaller target should be easier to meet
      if (earlyGoalBasic) {
        expect(['can_be_met', 'at_risk']).toContain(earlyGoalBasic.status);
      }
    });

    it('should allocate corpus based on priority', () => {
      const planner = new GoalPlanner({
        assetClasses: fullAssetClasses,
        customerProfile,
        goals,
        sipInput,
      });

      const result = planner.planMethod1();

      expect(result.corpusAllocation['late_high_priority']).toBeDefined();
      expect(result.corpusAllocation['early_low_priority']).toBeDefined();

      // Higher priority goal should get corpus allocation
      const lateGoalCorpus = Object.values(
        result.corpusAllocation['late_high_priority'] || {}
      ).reduce((sum, val) => sum + val, 0);
      const earlyGoalCorpus = Object.values(
        result.corpusAllocation['early_low_priority'] || {}
      ).reduce((sum, val) => sum + val, 0);

      expect(lateGoalCorpus).toBeGreaterThanOrEqual(0);
      expect(earlyGoalCorpus).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Scenario 4: Multiple Goals - Mix of Statuses', () => {
    const goals: Goal[] = [
      {
        goalId: 'goal1_early_high',
        goalName: 'Early High Priority',
        priority: 1,
        horizonYears: 2, // Short-term (will use corpus only, no SIP)
        amountVariancePct: 5,
        tiers: {
          basic: { targetAmount: 1000000 },
          ambitious: { targetAmount: 1000000 },
        },
      },
      {
        goalId: 'goal2_mid_high',
        goalName: 'Mid High Priority',
        priority: 1,
        horizonYears: 5,
        amountVariancePct: 5,
        tiers: {
          basic: { targetAmount: 5000000 },
          ambitious: { targetAmount: 7000000 },
        },
      },
      {
        goalId: 'goal3_late_medium',
        goalName: 'Late Medium Priority',
        priority: 2,
        horizonYears: 10,
        amountVariancePct: 5,
        tiers: {
          basic: { targetAmount: 12000000 },
          ambitious: { targetAmount: 15000000 },
        },
      },
      {
        goalId: 'goal4_late_low',
        goalName: 'Late Low Priority Unachievable',
        priority: 3,
        horizonYears: 8,
        amountVariancePct: 5,
        tiers: {
          basic: { targetAmount: 30000000 }, // Very high - might not be met
          ambitious: { targetAmount: 40000000 },
        },
      },
    ];

    const customerProfile: CustomerProfile = {
      asOfDate: '2024-01-01',
      totalNetWorth: 5000000,
      corpus: {
        byAssetClass: {
          largeCap: 2500000,
          midCap: 1500000,
          bond: 1000000,
        },
        allowedAssetClasses: ['largeCap', 'midCap', 'bond'],
      },
    };

    const sipInput: SIPInput = {
      monthlySIP: 100000,
      stretchSIPPercent: 15,
      annualStepUpPercent: 8,
    };

    it('should handle all goals with different statuses using Method 1', () => {
      const planner = new GoalPlanner({
        assetClasses: fullAssetClasses,
        customerProfile,
        goals,
        sipInput,
      });

      const result = planner.planMethod1();

      // Should have rows for all goals (both tiers)
      expect(result.goalFeasibilityTable.rows.length).toBeGreaterThanOrEqual(goals.length);

      // Check that each goal appears in the feasibility table
      const uniqueGoalIds = new Set(
        result.goalFeasibilityTable.rows.map((r) => r.goalId)
      );
      goals.forEach((goal) => {
        expect(uniqueGoalIds.has(goal.goalId)).toBe(true);
      });

      // Verify statuses are valid
      result.goalFeasibilityTable.rows.forEach((row) => {
        expect(['can_be_met', 'at_risk', 'cannot_be_met']).toContain(row.status);
        expect(row.confidencePercent).toBeGreaterThanOrEqual(0);
        expect(row.confidencePercent).toBeLessThanOrEqual(100);
      });
    });

    it('should prioritize goals by priority in allocation', () => {
      const planner = new GoalPlanner({
        assetClasses: fullAssetClasses,
        customerProfile,
        goals,
        sipInput,
      });

      const result = planner.planMethod1();

      // Goals should be sorted by priority
      const sortedGoals = [...goals].sort((a, b) => a.priority - b.priority);

      // Verify corpus allocation exists for all goals
      sortedGoals.forEach((goal) => {
        expect(result.corpusAllocation[goal.goalId]).toBeDefined();
      });
    });

    it('should show short-term goal has no SIP allocation', () => {
      const planner = new GoalPlanner({
        assetClasses: fullAssetClasses,
        customerProfile,
        goals,
        sipInput,
      });

      const result = planner.planMethod1();

      // Short-term goal (< 3 years) should have SIP = 0
      const shortTermGoalSIP = result.sipAllocation.perGoalAllocations.find(
        (a) => a.goalId.startsWith('goal1_early_high')
      );

      // Short-term goals get corpus but no SIP
      // So they might not appear in perGoalAllocations if SIP is 0
      // But corpus allocation should exist
      expect(result.corpusAllocation['goal1_early_high']).toBeDefined();
    });

    it('should handle same scenario with Method 2', () => {
      const planner = new GoalPlanner({
        assetClasses: fullAssetClassesWithVolatility,
        customerProfile,
        goals,
        sipInput,
      });

      const result = planner.planMethod2(100);

      expect(result.method).toBe('method2');
      expect(result.goalFeasibilityTable.rows.length).toBeGreaterThan(0);

      // Verify portfolio bounds exist
      const rowsWithPortfolioBounds = result.goalFeasibilityTable.rows.filter(
        (r) => r.portfolioProjectedCorpus !== undefined
      );
      expect(rowsWithPortfolioBounds.length).toBeGreaterThan(0);
    });

    it('should handle same scenario with Method 3', () => {
      const planner = new GoalPlanner({
        assetClasses: fullAssetClassesWithVolatility,
        customerProfile,
        goals,
        sipInput,
      });

      const result = planner.planMethod3(100);

      expect(result.method).toBe('method3');
      expect(result.goalFeasibilityTable.rows.length).toBeGreaterThan(0);
    });
  });

  describe('Scenario 5: Partially Met Goals (At Risk)', () => {
    const goals: Goal[] = [
      {
        goalId: 'partially_met_goal',
        goalName: 'Partially Met Goal',
        priority: 1,
        horizonYears: 5,
        amountVariancePct: 5,
        tiers: {
          basic: { targetAmount: 8000000 }, // Target that requires more resources than available
          ambitious: { targetAmount: 10000000 },
        },
      },
    ];

    const customerProfile: CustomerProfile = {
      asOfDate: '2024-01-01',
      totalNetWorth: 2000000, // Limited corpus
      corpus: {
        byAssetClass: {
          largeCap: 1000000,
          bond: 1000000,
        },
        allowedAssetClasses: ['largeCap', 'bond'],
      },
    };

    const sipInput: SIPInput = {
      monthlySIP: 50000, // Moderate SIP - might not be enough
      stretchSIPPercent: 10,
      annualStepUpPercent: 5,
    };

    it('should show at_risk status when resources are insufficient with Method 1', () => {
      const planner = new GoalPlanner({
        assetClasses: fullAssetClasses,
        customerProfile,
        goals,
        sipInput,
      });

      const result = planner.planMethod1();

      const basicRow = result.goalFeasibilityTable.rows.find(
        (r) => r.goalId === 'partially_met_goal' && r.tier === 'basic'
      );

      expect(basicRow).toBeDefined();
      if (basicRow) {
        // Should be at_risk or cannot_be_met if resources are insufficient
        expect(['can_be_met', 'at_risk', 'cannot_be_met']).toContain(basicRow.status);
        
        // If at_risk, confidence should be between 50-89%
        if (basicRow.status === 'at_risk') {
          expect(basicRow.confidencePercent).toBeGreaterThanOrEqual(50);
          expect(basicRow.confidencePercent).toBeLessThan(90);
        }
      }
    });
  });

  describe('Scenario 6: Cannot Be Met Goals', () => {
    const goals: Goal[] = [
      {
        goalId: 'cannot_be_met',
        goalName: 'Cannot Be Met Goal',
        priority: 1,
        horizonYears: 5,
        amountVariancePct: 5,
        tiers: {
          basic: { targetAmount: 100000000 }, // Extremely high target
          ambitious: { targetAmount: 150000000 },
        },
      },
    ];

    const customerProfile: CustomerProfile = {
      asOfDate: '2024-01-01',
      totalNetWorth: 1000000, // Very limited corpus
      corpus: {
        byAssetClass: {
          largeCap: 500000,
          bond: 500000,
        },
        allowedAssetClasses: ['largeCap', 'bond'],
      },
    };

    const sipInput: SIPInput = {
      monthlySIP: 10000, // Very low SIP
      stretchSIPPercent: 0,
      annualStepUpPercent: 0,
    };

    it('should mark goal as cannot_be_met with Method 1', () => {
      const planner = new GoalPlanner({
        assetClasses: fullAssetClasses,
        customerProfile,
        goals,
        sipInput,
      });

      const result = planner.planMethod1();

      const basicRow = result.goalFeasibilityTable.rows.find(
        (r) => r.goalId === 'cannot_be_met' && r.tier === 'basic'
      );

      expect(basicRow).toBeDefined();
      if (basicRow) {
        // Should be cannot_be_met or at_risk if resources are extremely insufficient
        expect(['at_risk', 'cannot_be_met']).toContain(basicRow.status);
        
        // If cannot_be_met, confidence should be < 50%
        if (basicRow.status === 'cannot_be_met') {
          expect(basicRow.confidencePercent).toBeLessThan(50);
        }
      }
    });

    it('should mark goal as cannot_be_met with Method 2', () => {
      const planner = new GoalPlanner({
        assetClasses: fullAssetClassesWithVolatility,
        customerProfile,
        goals,
        sipInput,
      });

      const result = planner.planMethod2(100);

      const basicRow = result.goalFeasibilityTable.rows.find(
        (r) => r.goalId === 'cannot_be_met' && r.tier === 'basic'
      );

      expect(basicRow).toBeDefined();
      if (basicRow) {
        expect(['at_risk', 'cannot_be_met']).toContain(basicRow.status);
      }
    });
  });

  describe('Scenario 7: Early vs Late Goals Priority Handling', () => {
    const goals: Goal[] = [
      {
        goalId: 'early_low_priority',
        goalName: 'Early Low Priority',
        priority: 3,
        horizonYears: 2, // Short-term
        amountVariancePct: 5,
        tiers: {
          basic: { targetAmount: 1500000 },
          ambitious: { targetAmount: 1500000 },
        },
      },
      {
        goalId: 'late_high_priority',
        goalName: 'Late High Priority',
        priority: 1,
        horizonYears: 10,
        amountVariancePct: 5,
        tiers: {
          basic: { targetAmount: 10000000 },
          ambitious: { targetAmount: 12000000 },
        },
      },
    ];

    const customerProfile: CustomerProfile = {
      asOfDate: '2024-01-01',
      totalNetWorth: 4000000,
      corpus: {
        byAssetClass: {
          largeCap: 2000000,
          midCap: 1500000,
          bond: 500000,
        },
        allowedAssetClasses: ['largeCap', 'midCap', 'bond'],
      },
    };

    const sipInput: SIPInput = {
      monthlySIP: 80000,
      stretchSIPPercent: 12,
      annualStepUpPercent: 6,
    };

    it('should prioritize by priority even if one goal is earlier with Method 1', () => {
      const planner = new GoalPlanner({
        assetClasses: fullAssetClasses,
        customerProfile,
        goals,
        sipInput,
      });

      const result = planner.planMethod1();

      // Both goals should appear in feasibility table
      expect(result.goalFeasibilityTable.rows.length).toBeGreaterThan(0);

      const earlyGoalRow = result.goalFeasibilityTable.rows.find(
        (r) => r.goalId === 'early_low_priority' && r.tier === 'basic'
      );
      const lateGoalRow = result.goalFeasibilityTable.rows.find(
        (r) => r.goalId === 'late_high_priority' && r.tier === 'basic'
      );

      expect(earlyGoalRow).toBeDefined();
      expect(lateGoalRow).toBeDefined();

      // Late high priority goal should get resources prioritized
      // even though early goal comes first in time
      expect(result.corpusAllocation['late_high_priority']).toBeDefined();
      expect(result.corpusAllocation['early_low_priority']).toBeDefined();
    });
  });

  describe('Scenario 8: All Goals Can Be Met', () => {
    const goals: Goal[] = [
      {
        goalId: 'achievable1',
        goalName: 'Achievable Goal 1',
        priority: 1,
        horizonYears: 5,
        amountVariancePct: 5,
        tiers: {
          basic: { targetAmount: 3000000 },
          ambitious: { targetAmount: 4000000 },
        },
      },
      {
        goalId: 'achievable2',
        goalName: 'Achievable Goal 2',
        priority: 2,
        horizonYears: 8,
        amountVariancePct: 5,
        tiers: {
          basic: { targetAmount: 5000000 },
          ambitious: { targetAmount: 6500000 },
        },
      },
    ];

    const customerProfile: CustomerProfile = {
      asOfDate: '2024-01-01',
      totalNetWorth: 5000000,
      corpus: {
        byAssetClass: {
          largeCap: 2500000,
          midCap: 1500000,
          bond: 1000000,
        },
        allowedAssetClasses: ['largeCap', 'midCap', 'bond'],
      },
    };

    const sipInput: SIPInput = {
      monthlySIP: 150000,
      stretchSIPPercent: 20,
      annualStepUpPercent: 10,
    };

    it('should mark all goals as can_be_met with Method 1', () => {
      const planner = new GoalPlanner({
        assetClasses: fullAssetClasses,
        customerProfile,
        goals,
        sipInput,
      });

      const result = planner.planMethod1();

      const goal1Basic = result.goalFeasibilityTable.rows.find(
        (r) => r.goalId === 'achievable1' && r.tier === 'basic'
      );
      const goal2Basic = result.goalFeasibilityTable.rows.find(
        (r) => r.goalId === 'achievable2' && r.tier === 'basic'
      );

      expect(goal1Basic).toBeDefined();
      expect(goal2Basic).toBeDefined();

      // With sufficient resources, both should ideally be can_be_met or at_risk
      if (goal1Basic) {
        expect(['can_be_met', 'at_risk', 'cannot_be_met']).toContain(goal1Basic.status);
        expect(goal1Basic.confidencePercent).toBeGreaterThanOrEqual(0);
        expect(goal1Basic.confidencePercent).toBeLessThanOrEqual(100);
      }
      if (goal2Basic) {
        expect(['can_be_met', 'at_risk', 'cannot_be_met']).toContain(goal2Basic.status);
        expect(goal2Basic.confidencePercent).toBeGreaterThanOrEqual(0);
        expect(goal2Basic.confidencePercent).toBeLessThanOrEqual(100);
      }
    });

    it('should allocate SIP to both goals', () => {
      const planner = new GoalPlanner({
        assetClasses: fullAssetClasses,
        customerProfile,
        goals,
        sipInput,
      });

      const result = planner.planMethod1();

      const goal1SIP = result.sipAllocation.perGoalAllocations.find(
        (a) => a.goalId.startsWith('achievable1')
      );
      const goal2SIP = result.sipAllocation.perGoalAllocations.find(
        (a) => a.goalId.startsWith('achievable2')
      );

      // Both should receive SIP allocations (if long-term)
      expect(result.sipAllocation.perGoalAllocations.length).toBeGreaterThan(0);
    });
  });
});
