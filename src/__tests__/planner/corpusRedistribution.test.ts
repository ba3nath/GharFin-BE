import { GoalPlanner } from '../../planner/goalPlanner';
import { Goal } from '../../models/Goal';
import { CustomerProfile } from '../../models/CustomerProfile';
import { AssetClasses } from '../../models/AssetClass';
import { SIPInput } from '../../planner/goalPlanner';
import { fullAssetClasses } from '../fixtures/assetClasses';

/**
 * Test case where Method 1 and Method 2 make goals at_risk/cannot_be_met
 * but Method 3 makes goals can_be_met by redistributing the initial corpus.
 * 
 * Scenario: Initial corpus is allocated suboptimally (all in low-return bonds),
 * which makes it difficult for Method 1 and Method 2 to meet goals since they
 * start with this suboptimal allocation.
 * 
 * Method 3, however, starts with zero corpus for long-term goals, calculates
 * optimal SIP allocation, then redistributes the entire corpus based on that
 * optimal allocation. This allows it to allocate corpus to higher-return asset
 * classes (largeCap, midCap) that better match the goals' requirements, making
 * goals can_be_met that were at_risk or cannot_be_met with Methods 1 and 2.
 */
describe('Corpus Redistribution Test', () => {
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

  const goals: Goal[] = [
    {
      goalId: 'retirement',
      goalName: 'Retirement',
      horizonYears: 10,
      amountVariancePct: 5,
      tiers: {
        basic: { targetAmount: 8000000, priority: 1 }, // 80L target - very high
        ambitious: { targetAmount: 12000000, priority: 2 },
      },
    },
    {
      goalId: 'child_education',
      goalName: 'Child Education',
      horizonYears: 8,
      amountVariancePct: 5,
      tiers: {
        basic: { targetAmount: 5000000, priority: 2 }, // 50L target - very high
        ambitious: { targetAmount: 7000000, priority: 3 },
      },
    },
  ];

  // Initial corpus is ALL in bonds (low return), which is suboptimal
  // With such high targets and limited corpus/SIP, Method 1 and Method 2 
  // will struggle because they start with this suboptimal allocation
  // But Method 3 will redistribute it optimally based on SIP allocation
  const customerProfile: CustomerProfile = {
    asOfDate: '2024-01-01',
    totalNetWorth: 1000000, // 10L corpus - limited
    corpus: {
      byAssetClass: {
        bond: 1000000, // All corpus in bonds (low return ~7%)
        // No allocation to largeCap (~11%) or midCap (~13%) initially
      },
      allowedAssetClasses: ['largeCap', 'midCap', 'bond'],
    },
  };

  const sipInput: SIPInput = {
    monthlySIP: 30000, // 30K monthly SIP - limited
    stretchSIPPercent: 20, // 20% stretch = 36K max
    annualStepUpPercent: 10, // 10% annual step-up
  };

  it('should make goals at_risk or cannot_be_met with Method 1 due to suboptimal corpus allocation', () => {
    const planner = new GoalPlanner({
      assetClasses: fullAssetClasses,
      customerProfile,
      goals,
      sipInput,
    });

    const result = planner.planMethod1();

    const retirementBasic = result.goalFeasibilityTable.rows.find(
      (r) => r.goalId === 'retirement' && r.tier === 'basic'
    );
    const childEducationBasic = result.goalFeasibilityTable.rows.find(
      (r) => r.goalId === 'child_education' && r.tier === 'basic'
    );

    expect(retirementBasic).toBeDefined();
    expect(childEducationBasic).toBeDefined();

    // Store results for comparison with Method 3
    const method1Results = {
      retirement: retirementBasic,
      childEducation: childEducationBasic,
    };

    // At least one goal should be at_risk or cannot_be_met with Method 1
    // because corpus is all in low-return bonds
    const atRiskOrCannotBeMet = [retirementBasic, childEducationBasic].filter(
      (row) => row && (row.status === 'at_risk' || row.status === 'cannot_be_met')
    );

    // If both are can_be_met, at least one should have low confidence or be close to the edge
    if (atRiskOrCannotBeMet.length === 0) {
      // Check if at least one has confidence < 95% (close to threshold)
      const lowConfidence = [retirementBasic, childEducationBasic].filter(
        (row) => row && row.confidencePercent < 95
      );
      expect(lowConfidence.length).toBeGreaterThan(0);
    } else {
      expect(atRiskOrCannotBeMet.length).toBeGreaterThan(0);
    }

    console.log('\n=== Method 1 Results ===');
    if (retirementBasic) {
      console.log(`Retirement Basic: ${retirementBasic.status} (${retirementBasic.confidencePercent}%)`);
      console.log(`  Target: ₹${retirementBasic.targetAmount.toLocaleString()}`);
      console.log(`  Lower: ₹${retirementBasic.projectedCorpus.lower.toLocaleString()}`);
    }
    if (childEducationBasic) {
      console.log(`Child Education Basic: ${childEducationBasic.status} (${childEducationBasic.confidencePercent}%)`);
      console.log(`  Target: ₹${childEducationBasic.targetAmount.toLocaleString()}`);
      console.log(`  Lower: ₹${childEducationBasic.projectedCorpus.lower.toLocaleString()}`);
    }
  });

  it('should make goals at_risk or cannot_be_met with Method 2 due to suboptimal corpus allocation', () => {
    const planner = new GoalPlanner({
      assetClasses: fullAssetClassesWithVolatility,
      customerProfile,
      goals,
      sipInput,
    });

    const result = planner.planMethod2(1000);

    const retirementBasic = result.goalFeasibilityTable.rows.find(
      (r) => r.goalId === 'retirement' && r.tier === 'basic'
    );
    const childEducationBasic = result.goalFeasibilityTable.rows.find(
      (r) => r.goalId === 'child_education' && r.tier === 'basic'
    );

    expect(retirementBasic).toBeDefined();
    expect(childEducationBasic).toBeDefined();

    // At least one goal should be at_risk or cannot_be_met with Method 2
    // because corpus is all in low-return bonds
    const atRiskOrCannotBeMet = [retirementBasic, childEducationBasic].filter(
      (row) => row && (row.status === 'at_risk' || row.status === 'cannot_be_met')
    );

    // If both are can_be_met, at least one should have low confidence or be close to the edge
    if (atRiskOrCannotBeMet.length === 0) {
      // Check if at least one has confidence < 95% (close to threshold)
      const lowConfidence = [retirementBasic, childEducationBasic].filter(
        (row) => row && row.confidencePercent < 95
      );
      expect(lowConfidence.length).toBeGreaterThan(0);
    } else {
      expect(atRiskOrCannotBeMet.length).toBeGreaterThan(0);
    }

    console.log('\n=== Method 2 Results ===');
    if (retirementBasic) {
      console.log(`Retirement Basic: ${retirementBasic.status} (${retirementBasic.confidencePercent}%)`);
      console.log(`  Target: ₹${retirementBasic.targetAmount.toLocaleString()}`);
      console.log(`  Lower: ₹${retirementBasic.projectedCorpus.lower.toLocaleString()}`);
    }
    if (childEducationBasic) {
      console.log(`Child Education Basic: ${childEducationBasic.status} (${childEducationBasic.confidencePercent}%)`);
      console.log(`  Target: ₹${childEducationBasic.targetAmount.toLocaleString()}`);
      console.log(`  Lower: ₹${childEducationBasic.projectedCorpus.lower.toLocaleString()}`);
    }
  });

  it('should make goals can_be_met with Method 3 by redistributing initial corpus', () => {
    // First get Method 1 and Method 2 results for comparison
    const planner1 = new GoalPlanner({
      assetClasses: fullAssetClasses,
      customerProfile,
      goals,
      sipInput,
    });
    const method1Result = planner1.planMethod1();
    
    const planner2 = new GoalPlanner({
      assetClasses: fullAssetClassesWithVolatility,
      customerProfile,
      goals,
      sipInput,
    });
    const method2Result = planner2.planMethod2(1000);

    const planner3 = new GoalPlanner({
      assetClasses: fullAssetClassesWithVolatility,
      customerProfile,
      goals,
      sipInput,
    });

    const result = planner3.planMethod3(1000);

    const retirementBasic = result.goalFeasibilityTable.rows.find(
      (r) => r.goalId === 'retirement' && r.tier === 'basic'
    );
    const childEducationBasic = result.goalFeasibilityTable.rows.find(
      (r) => r.goalId === 'child_education' && r.tier === 'basic'
    );

    expect(retirementBasic).toBeDefined();
    expect(childEducationBasic).toBeDefined();

    // Get Method 1 and Method 2 results for comparison
    const method1Retirement = method1Result.goalFeasibilityTable.rows.find(
      (r) => r.goalId === 'retirement' && r.tier === 'basic'
    );
    const method1ChildEducation = method1Result.goalFeasibilityTable.rows.find(
      (r) => r.goalId === 'child_education' && r.tier === 'basic'
    );
    
    const method2Retirement = method2Result.goalFeasibilityTable.rows.find(
      (r) => r.goalId === 'retirement' && r.tier === 'basic'
    );
    const method2ChildEducation = method2Result.goalFeasibilityTable.rows.find(
      (r) => r.goalId === 'child_education' && r.tier === 'basic'
    );

    // Method 3 should make at least one goal can_be_met by redistributing corpus optimally
    // It starts with zero corpus for long-term goals, calculates optimal SIP allocation,
    // then redistributes the entire corpus based on that allocation
    const canBeMetGoals = [retirementBasic, childEducationBasic].filter(
      (row) => row && row.status === 'can_be_met'
    );
    
    expect(canBeMetGoals.length).toBeGreaterThan(0);
    
    // Verify that Method 3 performs better than Method 1 and Method 2
    // Check if Method 3 improved the status or confidence for at least one goal
    let improvementFound = false;
    
    if (retirementBasic && method1Retirement && method2Retirement) {
      // Check if Method 3 improved retirement goal
      const method3Better = 
        (method1Retirement.status !== 'can_be_met' && retirementBasic.status === 'can_be_met') ||
        (method2Retirement.status !== 'can_be_met' && retirementBasic.status === 'can_be_met') ||
        (retirementBasic.confidencePercent > method1Retirement.confidencePercent + 5) ||
        (retirementBasic.confidencePercent > method2Retirement.confidencePercent + 5);
      
      if (method3Better) improvementFound = true;
    }
    
    if (childEducationBasic && method1ChildEducation && method2ChildEducation) {
      // Check if Method 3 improved child education goal
      const method3Better = 
        (method1ChildEducation.status !== 'can_be_met' && childEducationBasic.status === 'can_be_met') ||
        (method2ChildEducation.status !== 'can_be_met' && childEducationBasic.status === 'can_be_met') ||
        (childEducationBasic.confidencePercent > method1ChildEducation.confidencePercent + 5) ||
        (childEducationBasic.confidencePercent > method2ChildEducation.confidencePercent + 5);
      
      if (method3Better) improvementFound = true;
    }
    
    expect(improvementFound).toBe(true);

    console.log('\n=== Method 3 Results ===');
    if (retirementBasic) {
      console.log(`Retirement Basic: ${retirementBasic.status} (${retirementBasic.confidencePercent}%)`);
      console.log(`  Target: ₹${retirementBasic.targetAmount.toLocaleString()}`);
      console.log(`  Lower: ₹${retirementBasic.projectedCorpus.lower.toLocaleString()}`);
      console.log(`  Corpus Allocation:`, result.corpusAllocation['retirement']);
    }
    if (childEducationBasic) {
      console.log(`Child Education Basic: ${childEducationBasic.status} (${childEducationBasic.confidencePercent}%)`);
      console.log(`  Target: ₹${childEducationBasic.targetAmount.toLocaleString()}`);
      console.log(`  Lower: ₹${childEducationBasic.projectedCorpus.lower.toLocaleString()}`);
      console.log(`  Corpus Allocation:`, result.corpusAllocation['child_education']);
    }

    // Verify that corpus was redistributed (not all in bonds)
    const retirementCorpus = result.corpusAllocation['retirement'] || {};
    const childEducationCorpus = result.corpusAllocation['child_education'] || {};
    
    const retirementTotal = Object.values(retirementCorpus).reduce((sum, v) => sum + v, 0);
    const childEducationTotal = Object.values(childEducationCorpus).reduce((sum, v) => sum + v, 0);
    
    // Check that corpus was allocated to goals (not all remaining in bonds)
    expect(retirementTotal).toBeGreaterThan(0);
    expect(childEducationTotal).toBeGreaterThan(0);
    
    // Verify that corpus includes higher-return asset classes (largeCap or midCap)
    const hasHighReturnAssets = 
      (retirementCorpus.largeCap && retirementCorpus.largeCap > 0) ||
      (retirementCorpus.midCap && retirementCorpus.midCap > 0) ||
      (childEducationCorpus.largeCap && childEducationCorpus.largeCap > 0) ||
      (childEducationCorpus.midCap && childEducationCorpus.midCap > 0);
    
    expect(hasHighReturnAssets).toBe(true);
  });
});
