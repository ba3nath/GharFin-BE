import { GoalPlanner } from '../../planner/goalPlanner';
import { Goal } from '../../models/Goal';
import { CustomerProfile } from '../../models/CustomerProfile';
import { AssetClasses } from '../../models/AssetClass';
import { SIPInput } from '../../planner/goalPlanner';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Test scenario with 5 goals where ambitious tier cannot be met
 * but basic tier can be met for at least one goal
 */
describe('Cannot Be Met Scenario Test', () => {
  let testData: any;
  let assetClasses: AssetClasses;
  let customerProfile: CustomerProfile;
  let goals: Goal[];
  let sipInput: SIPInput;

  beforeAll(() => {
    // Load test data
    const testDataPath = path.join(__dirname, '../../../test-cannot-be-met-scenario.json');
    testData = JSON.parse(fs.readFileSync(testDataPath, 'utf-8'));

    assetClasses = testData.assetClasses;
    customerProfile = testData.customerProfile;
    goals = testData.goals.goals;
    sipInput = {
      monthlySIP: testData.monthlySIP,
      stretchSIPPercent: testData.stretchSIPPercent || 0,
      annualStepUpPercent: testData.annualStepUpPercent || 0,
    };
  });

  it('should have at least one ambitious tier marked as cannot_be_met while basic tier is can_be_met', () => {
    const planner = new GoalPlanner({
      assetClasses,
      customerProfile,
      goals,
      sipInput,
    });

    // Test Method 1
    const method1Result = planner.planMethod1();
    
    // Check for goals where basic is can_be_met but ambitious is cannot_be_met
    const cannotBeMetAmbitious = method1Result.goalFeasibilityTable.rows.filter(
      (row) => row.tier === 'ambitious' && row.status === 'cannot_be_met'
    );

    const canBeMetBasic = method1Result.goalFeasibilityTable.rows.filter(
      (row) => row.tier === 'basic' && row.status === 'can_be_met'
    );

    // Find goals where basic can be met but ambitious cannot be met
    const goalsWithCannotBeMetAmbitious: string[] = [];
    for (const ambitiousRow of cannotBeMetAmbitious) {
      const basicRow = method1Result.goalFeasibilityTable.rows.find(
        (r) => r.goalId === ambitiousRow.goalId && r.tier === 'basic'
      );
      if (basicRow && basicRow.status === 'can_be_met') {
        goalsWithCannotBeMetAmbitious.push(ambitiousRow.goalId);
      }
    }

    console.log('\n=== Method 1 Results ===');
    console.log(`Goals with cannot_be_met ambitious but can_be_met basic: ${goalsWithCannotBeMetAmbitious.length}`);
    goalsWithCannotBeMetAmbitious.forEach((goalId) => {
      const basicRow = method1Result.goalFeasibilityTable.rows.find(
        (r) => r.goalId === goalId && r.tier === 'basic'
      );
      const ambitiousRow = method1Result.goalFeasibilityTable.rows.find(
        (r) => r.goalId === goalId && r.tier === 'ambitious'
      );
      if (basicRow && ambitiousRow) {
        console.log(`\n${basicRow.goalName}:`);
        console.log(`  Basic: ${basicRow.status} (${basicRow.confidencePercent}%)`);
        console.log(`    Target: ₹${basicRow.targetAmount.toLocaleString()}`);
        console.log(`    Portfolio Mean: ₹${ambitiousRow.portfolioProjectedCorpus?.mean?.toLocaleString() || 'N/A'}`);
        console.log(`  Ambitious: ${ambitiousRow.status} (${ambitiousRow.confidencePercent}%)`);
        console.log(`    Target: ₹${ambitiousRow.targetAmount.toLocaleString()}`);
        console.log(`    Portfolio Mean: ₹${ambitiousRow.portfolioProjectedCorpus?.mean?.toLocaleString() || 'N/A'}`);
      }
    });

    // Verify we have at least one such goal
    expect(goalsWithCannotBeMetAmbitious.length).toBeGreaterThan(0);
  });

  it('should show portfolio-based feasibility for Method 2', () => {
    const planner = new GoalPlanner({
      assetClasses,
      customerProfile,
      goals,
      sipInput,
    });

    const method2Result = planner.planMethod2(100);

    // Check for goals where basic is can_be_met but ambitious is cannot_be_met
    const cannotBeMetAmbitious = method2Result.goalFeasibilityTable.rows.filter(
      (row) => row.tier === 'ambitious' && row.status === 'cannot_be_met'
    );

    const goalsWithCannotBeMetAmbitious: string[] = [];
    for (const ambitiousRow of cannotBeMetAmbitious) {
      const basicRow = method2Result.goalFeasibilityTable.rows.find(
        (r) => r.goalId === ambitiousRow.goalId && r.tier === 'basic'
      );
      if (basicRow && basicRow.status === 'can_be_met') {
        goalsWithCannotBeMetAmbitious.push(ambitiousRow.goalId);
      }
    }

    console.log('\n=== Method 2 Results ===');
    console.log(`Goals with cannot_be_met ambitious but can_be_met basic: ${goalsWithCannotBeMetAmbitious.length}`);
    goalsWithCannotBeMetAmbitious.forEach((goalId) => {
      const basicRow = method2Result.goalFeasibilityTable.rows.find(
        (r) => r.goalId === goalId && r.tier === 'basic'
      );
      const ambitiousRow = method2Result.goalFeasibilityTable.rows.find(
        (r) => r.goalId === goalId && r.tier === 'ambitious'
      );
      if (basicRow && ambitiousRow) {
        console.log(`\n${basicRow.goalName}:`);
        console.log(`  Basic: ${basicRow.status} (${basicRow.confidencePercent}%)`);
        console.log(`    Target: ₹${basicRow.targetAmount.toLocaleString()}`);
        console.log(`    Portfolio Mean: ₹${ambitiousRow.portfolioProjectedCorpus?.mean?.toLocaleString() || 'N/A'}`);
        console.log(`  Ambitious: ${ambitiousRow.status} (${ambitiousRow.confidencePercent}%)`);
        console.log(`    Target: ₹${ambitiousRow.targetAmount.toLocaleString()}`);
        console.log(`    Portfolio Mean: ₹${ambitiousRow.portfolioProjectedCorpus?.mean?.toLocaleString() || 'N/A'}`);
      }
    });

    expect(goalsWithCannotBeMetAmbitious.length).toBeGreaterThan(0);
  });

  it('should show all 5 goals in feasibility table', () => {
    const planner = new GoalPlanner({
      assetClasses,
      customerProfile,
      goals,
      sipInput,
    });

    const method1Result = planner.planMethod1();
    
    // Count unique goals
    const uniqueGoalIds = new Set(
      method1Result.goalFeasibilityTable.rows.map((r) => r.goalId)
    );

    expect(uniqueGoalIds.size).toBe(5);
    expect(uniqueGoalIds.has('medical_corpus')).toBe(true);
    expect(uniqueGoalIds.has('car_purchase')).toBe(true);
    expect(uniqueGoalIds.has('home_upgrade')).toBe(true);
    expect(uniqueGoalIds.has('child_education')).toBe(true);
    expect(uniqueGoalIds.has('retirement')).toBe(true);
  });

  it('should display both per-goal and portfolio bounds', () => {
    const planner = new GoalPlanner({
      assetClasses,
      customerProfile,
      goals,
      sipInput,
    });

    const method1Result = planner.planMethod1();
    
    // Check that all rows have portfolio bounds
    const rowsWithPortfolioBounds = method1Result.goalFeasibilityTable.rows.filter(
      (row) => row.portfolioProjectedCorpus !== undefined
    );

    expect(rowsWithPortfolioBounds.length).toBeGreaterThan(0);
    
    // Verify structure
    const firstRow = rowsWithPortfolioBounds[0];
    expect(firstRow.portfolioProjectedCorpus).toHaveProperty('lower');
    expect(firstRow.portfolioProjectedCorpus).toHaveProperty('mean');
    expect(firstRow.projectedCorpus).toHaveProperty('lower');
    expect(firstRow.projectedCorpus).toHaveProperty('mean');
  });
});
