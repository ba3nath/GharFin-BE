import { GoalPlanner } from '../../planner/goalPlanner';
import { Goal } from '../../models/Goal';
import { CustomerProfile } from '../../models/CustomerProfile';
import { AssetClasses } from '../../models/AssetClass';
import { SIPInput } from '../../planner/goalPlanner';
import {
  getOptimalAllocation,
  AssetAllocation,
} from '../../engine/portfolio';
import { getAssetClassData } from '../../models/AssetClass';
import { getTimeHorizonKey } from '../../utils/time';
import { yearsToMonths } from '../../utils/time';
import { corpusAtTimeWithStepUp, annualToMonthlyReturn } from '../../utils/math';

/**
 * Calculate required initial corpus to meet target at exactly 90% confidence with stretch SIP and step-up
 */
function calculateRequiredCorpusFor90ConfidenceWithStretchAndStepUp(
  targetAmount: number,
  horizonYears: number,
  assetAllocations: AssetAllocation[],
  assetClassDataMap: Record<string, any>,
  monthlySIP: number,
  stretchSIPPercent: number,
  stepUpPercent: number
): number {
  const months = yearsToMonths(horizonYears);
  
  const stretchSIP = monthlySIP * (1 + stretchSIPPercent / 100);
  const initialAvailableSIP = Math.max(monthlySIP, stretchSIP);
  
  let weightedReturn = 0;
  let weightedProbNegative = 0;
  let weightedExpectedShortfall = 0;
  let totalWeight = 0;

  for (const allocation of assetAllocations) {
    if (allocation.assetClass === "cash") continue;
    const data = assetClassDataMap[allocation.assetClass];
    if (!data) continue;

    const weight = allocation.percentage / 100;
    totalWeight += weight;

    weightedReturn += (data.avgReturnPct / 100) * weight;
    weightedProbNegative += (data.probNegativeYearPct / 100) * weight;
    weightedExpectedShortfall += (data.expectedShortfallPct / 100) * weight;
  }

  if (totalWeight > 0) {
    weightedReturn /= totalWeight;
    weightedProbNegative /= totalWeight;
    weightedExpectedShortfall /= totalWeight;
  }

  const avgPositiveReturn = (weightedReturn - weightedProbNegative * weightedExpectedShortfall) / (1 - weightedProbNegative || 0.01);
  const lowerAnnualReturn = weightedProbNegative * weightedExpectedShortfall + (1 - weightedProbNegative) * avgPositiveReturn;
  const lowerMonthlyReturn = annualToMonthlyReturn(lowerAnnualReturn);

  const sipFV = corpusAtTimeWithStepUp(0, initialAvailableSIP, stepUpPercent, lowerMonthlyReturn, months);
  const corpusFVFactor = Math.pow(1 + lowerMonthlyReturn, months);
  const requiredCorpus = (targetAmount - sipFV) / corpusFVFactor;

  return requiredCorpus;
}

function createTestScenario(
  goalId: string,
  goalName: string,
  monthlySIP: number,
  stretchSIPPercent: number,
  stepUpPercent: number
) {
  const goal: Goal = {
    goalId,
    goalName,
    priority: 1,
    horizonYears: 5,
    amountVariancePct: 0,
    tiers: {
      basic: { targetAmount: 5000000 },
      ambitious: { targetAmount: 5000000 },
    },
  };

  const assetClasses: AssetClasses = {
    smallCap: {
      "5Y": {
        avgReturnPct: 17.0,
        probNegativeYearPct: 28,
        expectedShortfallPct: -30,
        maxDrawdownPct: -50,
        volatilityPct: 27.0,
      },
    },
    midCap: {
      "5Y": {
        avgReturnPct: 14.0,
        probNegativeYearPct: 24,
        expectedShortfallPct: -22,
        maxDrawdownPct: -42,
        volatilityPct: 23.0,
      },
    },
    largeCap: {
      "5Y": {
        avgReturnPct: 11.5,
        probNegativeYearPct: 20,
        expectedShortfallPct: -17,
        maxDrawdownPct: -32,
        volatilityPct: 18.0,
      },
    },
    bond: {
      "5Y": {
        avgReturnPct: 6.8,
        probNegativeYearPct: 0,
        expectedShortfallPct: 0,
        maxDrawdownPct: 0,
        volatilityPct: 5.0,
      },
    },
  };

  const allowedAssetClasses = ['smallCap', 'midCap', 'largeCap', 'bond'];
  const optimalAllocation = getOptimalAllocation(
    goal,
    'basic',
    allowedAssetClasses,
    assetClasses,
    0
  );

  const timeHorizon = getTimeHorizonKey(goal.horizonYears);
  const assetClassDataMap: Record<string, any> = {};
  for (const alloc of optimalAllocation) {
    if (alloc.assetClass === 'cash') continue;
    const data = getAssetClassData(assetClasses, alloc.assetClass, timeHorizon);
    if (data) {
      assetClassDataMap[alloc.assetClass] = data;
    }
  }

  const targetAmount = goal.tiers.basic.targetAmount;
  const requiredCorpus = calculateRequiredCorpusFor90ConfidenceWithStretchAndStepUp(
    targetAmount,
    goal.horizonYears,
    optimalAllocation,
    assetClassDataMap,
    monthlySIP,
    stretchSIPPercent,
    stepUpPercent
  );

  const corpusByAssetClass: Record<string, number> = {};
  for (const alloc of optimalAllocation) {
    if (alloc.assetClass === 'cash') continue;
    corpusByAssetClass[alloc.assetClass] = (requiredCorpus * alloc.percentage) / 100;
  }

  const customerProfile: CustomerProfile = {
    asOfDate: '2024-01-01',
    totalNetWorth: requiredCorpus,
    corpus: {
      byAssetClass: corpusByAssetClass,
      allowedAssetClasses: allowedAssetClasses,
    },
  };

  const sipInput: SIPInput = {
    monthlySIP: monthlySIP,
    stretchSIPPercent: stretchSIPPercent,
    annualStepUpPercent: stepUpPercent,
  };

  return { goal, assetClasses, customerProfile, sipInput, optimalAllocation, requiredCorpus };
}

function runTest(goal: Goal, assetClasses: AssetClasses, customerProfile: CustomerProfile, sipInput: SIPInput, optimalAllocation: AssetAllocation[], requiredCorpus: number) {
  let testCorpus = requiredCorpus;
  let method1Confidence = 0;
  let iterations = 0;
  const maxIterations = 20;
  
  let lowCorpus = requiredCorpus * 0.8;
  let highCorpus = requiredCorpus * 1.2;
  
  while (iterations < maxIterations && Math.abs(method1Confidence - 90) > 1) {
    testCorpus = (lowCorpus + highCorpus) / 2;
    
    const testCorpusByAssetClass: Record<string, number> = {};
    for (const alloc of optimalAllocation) {
      if (alloc.assetClass === 'cash') continue;
      testCorpusByAssetClass[alloc.assetClass] = (testCorpus * alloc.percentage) / 100;
    }
    
    const testProfile: CustomerProfile = {
      ...customerProfile,
      totalNetWorth: testCorpus,
      corpus: {
        ...customerProfile.corpus,
        byAssetClass: testCorpusByAssetClass,
      },
    };
    
    const testPlanner = new GoalPlanner({
      assetClasses,
      customerProfile: testProfile,
      goals: [goal],
      sipInput,
    });
    
    const testResult = testPlanner.planMethod1();
    const testRow = testResult.goalFeasibilityTable.rows.find(
      (row) => row.goalId === goal.goalId && row.tier === 'basic'
    );
    
    if (testRow) {
      method1Confidence = testRow.confidencePercent;
      if (method1Confidence < 90) {
        lowCorpus = testCorpus;
      } else {
        highCorpus = testCorpus;
      }
    } else {
      break;
    }
    
    iterations++;
  }
  
  const finalCorpusByAssetClass: Record<string, number> = {};
  for (const alloc of optimalAllocation) {
    if (alloc.assetClass === 'cash') continue;
    finalCorpusByAssetClass[alloc.assetClass] = (testCorpus * alloc.percentage) / 100;
  }
  
  const finalCustomerProfile: CustomerProfile = {
    ...customerProfile,
    totalNetWorth: testCorpus,
    corpus: {
      ...customerProfile.corpus,
      byAssetClass: finalCorpusByAssetClass,
    },
  };

  const planner1 = new GoalPlanner({
    assetClasses,
    customerProfile: finalCustomerProfile,
    goals: [goal],
    sipInput,
  });

  const method1Result = planner1.planMethod1();
  const method1Row = method1Result.goalFeasibilityTable.rows.find(
    (row) => row.goalId === goal.goalId && row.tier === 'basic'
  );

  expect(method1Row).toBeDefined();
  if (method1Row) {
    expect(method1Row.confidencePercent).toBeGreaterThanOrEqual(85);
    expect(method1Row.confidencePercent).toBeLessThanOrEqual(95);
    if (method1Row.confidencePercent >= 90) {
      expect(method1Row.status).toBe('can_be_met');
    } else {
      expect(['can_be_met', 'at_risk']).toContain(method1Row.status);
    }
  }

  const planner2 = new GoalPlanner({
    assetClasses,
    customerProfile: finalCustomerProfile,
    goals: [goal],
    sipInput,
  });

  const method2Result = planner2.planMethod2(1000);
  const method2Row = method2Result.goalFeasibilityTable.rows.find(
    (row) => row.goalId === goal.goalId && row.tier === 'basic'
  );

  expect(method2Row).toBeDefined();
  if (method2Row) {
    expect(method2Row.confidencePercent).toBeGreaterThan(0);
    expect(method2Row.confidencePercent).toBeLessThanOrEqual(100);
    
    if (method2Row.confidencePercent >= 90) {
      expect(method2Row.status).toBe('can_be_met');
    } else if (method2Row.confidencePercent >= 50) {
      expect(method2Row.status).toBe('at_risk');
    } else {
      expect(method2Row.status).toBe('cannot_be_met');
    }
  }

  expect(method1Row?.confidencePercent).toBeGreaterThanOrEqual(85);
  expect(method1Row?.confidencePercent).toBeLessThanOrEqual(95);
  expect(method1Row?.status).not.toBe('cannot_be_met');
}

describe('Exact 90% Confidence Test with High Stretch SIP and Step-up', () => {
  it('should return 90% confidence for Method 1 and Method 2 when networth exactly meets goal with 1000 SIP, 20% stretch, and 20% stepup', () => {
    const scenario = createTestScenario(
      'test-goal-90-high-stretch-stepup-20',
      'Test Goal 90% Confidence with 20% Stretch and 20% Step-up',
      1000,
      20,
      20
    );
    runTest(scenario.goal, scenario.assetClasses, scenario.customerProfile, scenario.sipInput, scenario.optimalAllocation, scenario.requiredCorpus);
  }, 60000);

  it('should return 90% confidence for Method 1 and Method 2 when networth exactly meets goal with 1000 SIP, 30% stretch, and 30% stepup', () => {
    const scenario = createTestScenario(
      'test-goal-90-high-stretch-stepup-30',
      'Test Goal 90% Confidence with 30% Stretch and 30% Step-up',
      1000,
      30,
      30
    );
    runTest(scenario.goal, scenario.assetClasses, scenario.customerProfile, scenario.sipInput, scenario.optimalAllocation, scenario.requiredCorpus);
  }, 60000);
});
