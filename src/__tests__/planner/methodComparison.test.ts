import { GoalPlanner } from '../../planner/goalPlanner';
import { Goal } from '../../models/Goal';
import { CustomerProfile } from '../../models/CustomerProfile';
import { AssetClasses } from '../../models/AssetClass';
import { SIPInput } from '../../planner/goalPlanner';
import { fullAssetClasses } from '../fixtures/assetClasses';

/**
 * Test cases comparing the performance of Method 1, Method 2, and Method 3
 * to identify scenarios where each method performs better.
 * 
 * Key Differences:
 * - Method 1: Envelope method with probability-based modeling (probNegativeYearPct, expectedShortfallPct)
 *   - More deterministic, can be more optimistic in low-volatility scenarios
 *   - Works well when corpus allocation is already optimal
 * 
 * - Method 2: Monte Carlo simulation with volatility-based modeling (volatilityPct)
 *   - More conservative, accounts for volatility explicitly
 *   - Better risk assessment in high-volatility scenarios
 * 
 * - Method 3: Monte Carlo simulation with corpus redistribution
 *   - Starts with zero corpus for long-term goals
 *   - Redistributes entire corpus based on optimal SIP allocation
 *   - Can improve outcomes when initial corpus allocation is suboptimal
 */

describe('Method Comparison Tests', () => {
  describe('Scenario 1: Method 1 Better Than Method 2 and 3', () => {
    /**
     * Scenario where Method 1 (envelope method) performs better:
     * - Low volatility asset classes where envelope method's probability-based
     *   approach is more accurate than Monte Carlo's volatility-based approach
     * - Corpus allocation is already optimal
     * - Envelope method is less conservative than Monte Carlo in this scenario
     */
    const assetClassesForMethod1: AssetClasses = {
      largeCap: {
        "3Y": { avgReturnPct: 12.0, probNegativeYearPct: 15, expectedShortfallPct: -12, maxDrawdownPct: -25, volatilityPct: 18.0 },
        "5Y": { avgReturnPct: 11.5, probNegativeYearPct: 12, expectedShortfallPct: -10, maxDrawdownPct: -22, volatilityPct: 16.0 },
        "10Y": { avgReturnPct: 11.0, probNegativeYearPct: 10, expectedShortfallPct: -8, maxDrawdownPct: -20, volatilityPct: 14.0 },
      },
      bond: {
        "3Y": { avgReturnPct: 7.0, probNegativeYearPct: 0, expectedShortfallPct: 0, maxDrawdownPct: 0, volatilityPct: 4.0 },
        "5Y": { avgReturnPct: 7.2, probNegativeYearPct: 0, expectedShortfallPct: 0, maxDrawdownPct: 0, volatilityPct: 4.0 },
        "10Y": { avgReturnPct: 7.5, probNegativeYearPct: 0, expectedShortfallPct: 0, maxDrawdownPct: 0, volatilityPct: 4.0 },
      },
    };

    const assetClassesWithVolatility: AssetClasses = {
      largeCap: {
        "3Y": { avgReturnPct: 12.0, probNegativeYearPct: 15, expectedShortfallPct: -12, maxDrawdownPct: -25, volatilityPct: 18.0 },
        "5Y": { avgReturnPct: 11.5, probNegativeYearPct: 12, expectedShortfallPct: -10, maxDrawdownPct: -22, volatilityPct: 16.0 },
        "10Y": { avgReturnPct: 11.0, probNegativeYearPct: 10, expectedShortfallPct: -8, maxDrawdownPct: -20, volatilityPct: 14.0 },
      },
      bond: {
        "3Y": { avgReturnPct: 7.0, probNegativeYearPct: 0, expectedShortfallPct: 0, maxDrawdownPct: 0, volatilityPct: 4.0 },
        "5Y": { avgReturnPct: 7.2, probNegativeYearPct: 0, expectedShortfallPct: 0, maxDrawdownPct: 0, volatilityPct: 4.0 },
        "10Y": { avgReturnPct: 7.5, probNegativeYearPct: 0, expectedShortfallPct: 0, maxDrawdownPct: 0, volatilityPct: 4.0 },
      },
    };

    const goals: Goal[] = [
      {
        goalId: 'retirement',
        goalName: 'Retirement',
        horizonYears: 10,
        amountVariancePct: 5,
        tiers: {
          basic: { targetAmount: 5000000, priority: 1 }, // 50L target
          ambitious: { targetAmount: 7000000, priority: 2 },
        },
      },
    ];

    // Optimal corpus allocation (already well-distributed)
    const customerProfile: CustomerProfile = {
      asOfDate: '2024-01-01',
      totalNetWorth: 2000000, // 20L corpus
      corpus: {
        byAssetClass: {
          largeCap: 1500000, // 75% in largeCap (optimal)
          bond: 500000,      // 25% in bonds (optimal)
        },
        allowedAssetClasses: ['largeCap', 'bond'],
      },
    };

    const sipInput: SIPInput = {
      monthlySIP: 25000, // 25K monthly SIP
      stretchSIPPercent: 10,
      annualStepUpPercent: 8,
    };

    it('should show Method 1 performs at least as well as Method 2 and Method 3', () => {
      const planner1 = new GoalPlanner({
        assetClasses: assetClassesForMethod1,
        customerProfile,
        goals,
        sipInput,
      });

      const planner2 = new GoalPlanner({
        assetClasses: assetClassesWithVolatility,
        customerProfile,
        goals,
        sipInput,
      });

      const planner3 = new GoalPlanner({
        assetClasses: assetClassesWithVolatility,
        customerProfile,
        goals,
        sipInput,
      });

      const method1Result = planner1.planMethod1();
      const method2Result = planner2.planMethod2(1000);
      const method3Result = planner3.planMethod3(1000);

      const method1Retirement = method1Result.goalFeasibilityTable.rows.find(
        (r) => r.goalId === 'retirement' && r.tier === 'basic'
      );
      const method2Retirement = method2Result.goalFeasibilityTable.rows.find(
        (r) => r.goalId === 'retirement' && r.tier === 'basic'
      );
      const method3Retirement = method3Result.goalFeasibilityTable.rows.find(
        (r) => r.goalId === 'retirement' && r.tier === 'basic'
      );

      expect(method1Retirement).toBeDefined();
      expect(method2Retirement).toBeDefined();
      expect(method3Retirement).toBeDefined();

      console.log('\n=== Method 1 Results ===');
      if (method1Retirement) {
        console.log(`Retirement Basic: ${method1Retirement.status} (${method1Retirement.confidencePercent}%)`);
        console.log(`  Target: ₹${method1Retirement.targetAmount.toLocaleString()}`);
        console.log(`  Lower: ₹${method1Retirement.projectedCorpus.lower.toLocaleString()}`);
      }

      console.log('\n=== Method 2 Results ===');
      if (method2Retirement) {
        console.log(`Retirement Basic: ${method2Retirement.status} (${method2Retirement.confidencePercent}%)`);
        console.log(`  Target: ₹${method2Retirement.targetAmount.toLocaleString()}`);
        console.log(`  Lower: ₹${method2Retirement.projectedCorpus.lower.toLocaleString()}`);
      }

      console.log('\n=== Method 3 Results ===');
      if (method3Retirement) {
        console.log(`Retirement Basic: ${method3Retirement.status} (${method3Retirement.confidencePercent}%)`);
        console.log(`  Target: ₹${method3Retirement.targetAmount.toLocaleString()}`);
        console.log(`  Lower: ₹${method3Retirement.projectedCorpus.lower.toLocaleString()}`);
      }

      // Method 1 should perform at least as well as Method 2 and Method 3
      // All methods now use portfolio Monte Carlo for confidence; with low volatility
      // Method 1 (envelope planning) should achieve can_be_met
      let method1NotWorse = false;

      if (method1Retirement && method2Retirement && method3Retirement) {
        const method1Status = method1Retirement.status;
        const method2Status = method2Retirement.status;
        const method3Status = method3Retirement.status;

        const statusValue = (status: string) => {
          if (status === 'can_be_met') return 3;
          if (status === 'at_risk') return 2;
          return 1;
        };

        const method1StatusValue = statusValue(method1Status);
        const method2StatusValue = statusValue(method2Status);
        const method3StatusValue = statusValue(method3Status);

        // Method 1 should have status at least as good as Method 2 and Method 3
        method1NotWorse = method1StatusValue >= method2StatusValue && method1StatusValue >= method3StatusValue;
      }

      expect(method1NotWorse).toBe(true);
      expect(method1Retirement?.status).not.toBe('cannot_be_met');
    });
  });

  describe('Scenario 2: Method 2 Better Than Method 1 and 3', () => {
    /**
     * Scenario where Method 2 (Monte Carlo with volatility) performs better:
     * - High volatility asset classes where volatility modeling is important
     * - Monte Carlo provides better risk assessment than envelope method
     * - Envelope method is too optimistic in this scenario
     */
    const assetClassesForMethod2: AssetClasses = {
      largeCap: {
        "3Y": { avgReturnPct: 12.0, probNegativeYearPct: 25, expectedShortfallPct: -20, maxDrawdownPct: -40, volatilityPct: 22.0 },
        "5Y": { avgReturnPct: 11.5, probNegativeYearPct: 23, expectedShortfallPct: -18, maxDrawdownPct: -38, volatilityPct: 20.0 },
        "10Y": { avgReturnPct: 11.0, probNegativeYearPct: 20, expectedShortfallPct: -16, maxDrawdownPct: -35, volatilityPct: 18.0 },
      },
      midCap: {
        "3Y": { avgReturnPct: 15.0, probNegativeYearPct: 30, expectedShortfallPct: -28, maxDrawdownPct: -50, volatilityPct: 28.0 },
        "5Y": { avgReturnPct: 14.0, probNegativeYearPct: 28, expectedShortfallPct: -26, maxDrawdownPct: -48, volatilityPct: 26.0 },
        "10Y": { avgReturnPct: 13.0, probNegativeYearPct: 25, expectedShortfallPct: -24, maxDrawdownPct: -45, volatilityPct: 24.0 },
      },
      bond: {
        "3Y": { avgReturnPct: 6.5, probNegativeYearPct: 0, expectedShortfallPct: 0, maxDrawdownPct: 0, volatilityPct: 5.0 },
        "5Y": { avgReturnPct: 6.8, probNegativeYearPct: 0, expectedShortfallPct: 0, maxDrawdownPct: 0, volatilityPct: 5.0 },
        "10Y": { avgReturnPct: 7.0, probNegativeYearPct: 0, expectedShortfallPct: 0, maxDrawdownPct: 0, volatilityPct: 5.0 },
      },
    };

    const goals: Goal[] = [
      {
        goalId: 'retirement',
        goalName: 'Retirement',
        horizonYears: 10,
        amountVariancePct: 5,
        tiers: {
          basic: { targetAmount: 6000000, priority: 1 }, // 60L target
          ambitious: { targetAmount: 9000000, priority: 2 },
        },
      },
    ];

    // Corpus with high allocation to volatile assets
    const customerProfile: CustomerProfile = {
      asOfDate: '2024-01-01',
      totalNetWorth: 1500000, // 15L corpus
      corpus: {
        byAssetClass: {
          largeCap: 600000,  // 40% in largeCap
          midCap: 600000,    // 40% in midCap (high volatility)
          bond: 300000,      // 20% in bonds
        },
        allowedAssetClasses: ['largeCap', 'midCap', 'bond'],
      },
    };

    const sipInput: SIPInput = {
      monthlySIP: 30000, // 30K monthly SIP
      stretchSIPPercent: 15,
      annualStepUpPercent: 10,
    };

    it('should show Method 2 performs at least as well as Method 1 and Method 3', () => {
      const planner1 = new GoalPlanner({
        assetClasses: assetClassesForMethod2,
        customerProfile,
        goals,
        sipInput,
      });

      const planner2 = new GoalPlanner({
        assetClasses: assetClassesForMethod2,
        customerProfile,
        goals,
        sipInput,
      });

      const planner3 = new GoalPlanner({
        assetClasses: assetClassesForMethod2,
        customerProfile,
        goals,
        sipInput,
      });

      const method1Result = planner1.planMethod1();
      const method2Result = planner2.planMethod2(1000);
      const method3Result = planner3.planMethod3(1000);

      const method1Retirement = method1Result.goalFeasibilityTable.rows.find(
        (r) => r.goalId === 'retirement' && r.tier === 'basic'
      );
      const method2Retirement = method2Result.goalFeasibilityTable.rows.find(
        (r) => r.goalId === 'retirement' && r.tier === 'basic'
      );
      const method3Retirement = method3Result.goalFeasibilityTable.rows.find(
        (r) => r.goalId === 'retirement' && r.tier === 'basic'
      );

      expect(method1Retirement).toBeDefined();
      expect(method2Retirement).toBeDefined();
      expect(method3Retirement).toBeDefined();

      console.log('\n=== Method 1 Results ===');
      if (method1Retirement) {
        console.log(`Retirement Basic: ${method1Retirement.status} (${method1Retirement.confidencePercent}%)`);
        console.log(`  Target: ₹${method1Retirement.targetAmount.toLocaleString()}`);
        console.log(`  Lower: ₹${method1Retirement.projectedCorpus.lower.toLocaleString()}`);
      }

      console.log('\n=== Method 2 Results ===');
      if (method2Retirement) {
        console.log(`Retirement Basic: ${method2Retirement.status} (${method2Retirement.confidencePercent}%)`);
        console.log(`  Target: ₹${method2Retirement.targetAmount.toLocaleString()}`);
        console.log(`  Lower: ₹${method2Retirement.projectedCorpus.lower.toLocaleString()}`);
      }

      console.log('\n=== Method 3 Results ===');
      if (method3Retirement) {
        console.log(`Retirement Basic: ${method3Retirement.status} (${method3Retirement.confidencePercent}%)`);
        console.log(`  Target: ₹${method3Retirement.targetAmount.toLocaleString()}`);
        console.log(`  Lower: ₹${method3Retirement.projectedCorpus.lower.toLocaleString()}`);
      }

      // Method 2 should perform at least as well as Method 1 and Method 3
      // All methods now use portfolio Monte Carlo for confidence; with high volatility
      // Method 2 (Monte Carlo planning) should achieve can_be_met
      let method2NotWorse = false;

      if (method2Retirement && method1Retirement && method3Retirement) {
        const method1Status = method1Retirement.status;
        const method2Status = method2Retirement.status;
        const method3Status = method3Retirement.status;

        const statusValue = (status: string) => {
          if (status === 'can_be_met') return 3;
          if (status === 'at_risk') return 2;
          return 1;
        };

        const method1StatusValue = statusValue(method1Status);
        const method2StatusValue = statusValue(method2Status);
        const method3StatusValue = statusValue(method3Status);

        // Method 2 should have status at least as good as Method 1 and Method 3
        method2NotWorse = method2StatusValue >= method1StatusValue && method2StatusValue >= method3StatusValue;
      }

      expect(method2NotWorse).toBe(true);
      expect(method2Retirement?.status).not.toBe('cannot_be_met');
    });
  });
});
