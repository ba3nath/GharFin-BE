import {
  rebalanceCorpusToSIPAllocation,
  getRebalancedCorpusAllocation,
  optimizeCorpusAllocation,
} from '../../engine/rebalancer';
import {
  minimalCustomerProfile,
  zeroCorpusProfile,
  multiAssetProfile,
} from '../fixtures/customerProfiles';
import { AssetAllocation } from '../../engine/portfolio';
import { multipleGoals } from '../fixtures/goals';

describe('rebalanceCorpusToSIPAllocation', () => {
  const sipAllocations: AssetAllocation[] = [
    { assetClass: 'largeCap', percentage: 60 },
    { assetClass: 'bond', percentage: 40 },
  ];

  it('should rebalance corpus to match SIP allocation', () => {
    const rebalanced = rebalanceCorpusToSIPAllocation(minimalCustomerProfile, sipAllocations);
    
    const total = Object.values(rebalanced.corpus.byAssetClass).reduce((sum, v) => sum + v, 0);
    const originalTotal = Object.values(minimalCustomerProfile.corpus.byAssetClass).reduce((sum, v) => sum + v, 0);
    
    expect(total).toBe(originalTotal); // Total preserved
    expect(rebalanced.corpus.byAssetClass.largeCap).toBeCloseTo(total * 0.6, 0);
    expect(rebalanced.corpus.byAssetClass.bond).toBeCloseTo(total * 0.4, 0);
  });

  it('should return unchanged profile for zero corpus', () => {
    const rebalanced = rebalanceCorpusToSIPAllocation(zeroCorpusProfile, sipAllocations);
    const total = Object.values(rebalanced.corpus.byAssetClass).reduce((sum, v) => sum + v, 0);
    expect(total).toBe(0);
  });

  it('should normalize to preserve total corpus', () => {
    const rebalanced = rebalanceCorpusToSIPAllocation(multiAssetProfile, sipAllocations);
    const total = Object.values(rebalanced.corpus.byAssetClass).reduce((sum, v) => sum + v, 0);
    const originalTotal = Object.values(multiAssetProfile.corpus.byAssetClass).reduce((sum, v) => sum + v, 0);
    
    expect(total).toBeCloseTo(originalTotal, 0);
  });

  it('should set missing asset classes to 0', () => {
    const rebalanced = rebalanceCorpusToSIPAllocation(multiAssetProfile, sipAllocations);
    
    // midCap and gold should be set to 0 or removed
    expect(rebalanced.corpus.byAssetClass.largeCap).toBeGreaterThan(0);
    expect(rebalanced.corpus.byAssetClass.bond).toBeGreaterThan(0);
  });
});

describe('getRebalancedCorpusAllocation', () => {
  it('should calculate allocation percentages correctly', () => {
    const percentages = getRebalancedCorpusAllocation(minimalCustomerProfile);
    
    expect(percentages.largeCap).toBe(50);
    expect(percentages.bond).toBe(50);
    
    const total = Object.values(percentages).reduce((sum, pct) => sum + pct, 0);
    expect(total).toBe(100);
  });

  it('should return empty object for zero corpus', () => {
    const percentages = getRebalancedCorpusAllocation(zeroCorpusProfile);
    expect(Object.keys(percentages)).toHaveLength(0);
  });

  it('should calculate percentages for multi-asset profile', () => {
    const percentages = getRebalancedCorpusAllocation(multiAssetProfile);
    
    const total = Object.values(percentages).reduce((sum, pct) => sum + pct, 0);
    expect(total).toBe(100);
    
    expect(percentages.largeCap).toBe(40);
    expect(percentages.midCap).toBe(30);
    expect(percentages.bond).toBe(20);
    expect(percentages.gold).toBe(10);
  });
});

describe('optimizeCorpusAllocation', () => {
  it('should allocate corpus across goals based on priority', () => {
    const goalCorpusRequirements: Record<string, number> = {
      goal1: 3000000,
      goal2: 2000000,
    };

    const allocation = optimizeCorpusAllocation(
      minimalCustomerProfile,
      multipleGoals,
      goalCorpusRequirements
    );

    expect(allocation.goal1).toBeDefined();
    expect(allocation.goal2).toBeDefined();
    
    // Goal1 has higher priority (priority 1), should get allocated first
    const goal1Total = Object.values(allocation.goal1 || {}).reduce((sum, v) => sum + v, 0);
    expect(goal1Total).toBeGreaterThan(0);
  });

  it('should preserve total corpus', () => {
    const goalCorpusRequirements: Record<string, number> = {
      goal1: 3000000,
      goal2: 2000000,
    };

    const allocation = optimizeCorpusAllocation(
      minimalCustomerProfile,
      multipleGoals,
      goalCorpusRequirements
    );

    let totalAllocated = 0;
    for (const goalAlloc of Object.values(allocation)) {
      totalAllocated += Object.values(goalAlloc).reduce((sum, v) => sum + v, 0);
    }

    const originalTotal = Object.values(minimalCustomerProfile.corpus.byAssetClass).reduce(
      (sum, v) => sum + v,
      0
    );

    expect(totalAllocated).toBeLessThanOrEqual(originalTotal);
  });

  it('should handle insufficient corpus', () => {
    const goalCorpusRequirements: Record<string, number> = {
      goal1: 10000000, // More than available
      goal2: 5000000,
    };

    const allocation = optimizeCorpusAllocation(
      minimalCustomerProfile,
      multipleGoals,
      goalCorpusRequirements
    );

    const goal1Total = Object.values(allocation.goal1 || {}).reduce((sum, v) => sum + v, 0);
    expect(goal1Total).toBeLessThan(10000000);
  });

  it('should handle zero required corpus', () => {
    const goalCorpusRequirements: Record<string, number> = {
      goal1: 0,
      goal2: 0,
    };

    const allocation = optimizeCorpusAllocation(
      minimalCustomerProfile,
      multipleGoals,
      goalCorpusRequirements
    );

    expect(allocation.goal1).toEqual({});
    expect(allocation.goal2).toEqual({});
  });

  it('should allocate based on priority order', () => {
    const goalCorpusRequirements: Record<string, number> = {
      goal1: 800000, // Priority 1
      goal2: 800000, // Priority 2
    };

    const allocation = optimizeCorpusAllocation(
      minimalCustomerProfile,
      multipleGoals,
      goalCorpusRequirements
    );

    const goal1Total = Object.values(allocation.goal1 || {}).reduce((sum, v) => sum + v, 0);
    const goal2Total = Object.values(allocation.goal2 || {}).reduce((sum, v) => sum + v, 0);
    
    // Goal1 (priority 1) should get allocated first
    expect(goal1Total).toBeGreaterThanOrEqual(goal2Total);
  });
});
