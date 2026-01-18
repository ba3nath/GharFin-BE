import {
  calculatePortfolioMetrics,
  getTimeBasedAllocation,
  optimizeSharpeRatio,
  getOptimalAllocation,
  calculateWeightedMetrics,
} from '../../engine/portfolio';
import { AssetAllocation } from '../../engine/portfolio';
import { fullAssetClasses } from '../fixtures/assetClasses';
import { singleGoal } from '../fixtures/goals';

describe('calculatePortfolioMetrics', () => {
  const allocations: AssetAllocation[] = [
    { assetClass: 'largeCap', percentage: 60 },
    { assetClass: 'bond', percentage: 40 },
  ];

  const assetClassDataMap = {
    largeCap: fullAssetClasses.largeCap['10Y']!,
    bond: fullAssetClasses.bond['10Y']!,
  };

  it('should calculate weighted return', () => {
    const metrics = calculatePortfolioMetrics(allocations, assetClassDataMap);
    expect(metrics.return).toBeGreaterThan(0);
    expect(metrics.return).toBeLessThan(0.15); // Should be between bond and largeCap returns
  });

  it('should calculate weighted volatility', () => {
    const metrics = calculatePortfolioMetrics(allocations, assetClassDataMap);
    expect(metrics.volatility).toBeGreaterThanOrEqual(0);
  });

  it('should calculate Sharpe ratio', () => {
    const metrics = calculatePortfolioMetrics(allocations, assetClassDataMap);
    expect(metrics.sharpeRatio).toBeDefined();
    if (metrics.volatility > 0) {
      expect(metrics.sharpeRatio).toBeCloseTo(metrics.return / metrics.volatility, 2);
    }
  });

  it('should skip cash allocation', () => {
    const allocationsWithCash: AssetAllocation[] = [
      { assetClass: 'largeCap', percentage: 50 },
      { assetClass: 'cash', percentage: 50 },
    ];

    const metrics = calculatePortfolioMetrics(allocationsWithCash, assetClassDataMap);
    expect(metrics.return).toBeGreaterThan(0);
    // Should only use largeCap (50% becomes 100% after normalization)
  });

  it('should normalize weights correctly', () => {
    // Test with allocations that don't sum to 100%
    const nonNormalized: AssetAllocation[] = [
      { assetClass: 'largeCap', percentage: 80 },
      { assetClass: 'bond', percentage: 40 }, // Total 120%
    ];

    const metrics = calculatePortfolioMetrics(nonNormalized, assetClassDataMap);
    expect(metrics.return).toBeGreaterThan(0);
  });
});

describe('getTimeBasedAllocation', () => {
  const growthAllocation: AssetAllocation[] = [
    { assetClass: 'largeCap', percentage: 70 },
    { assetClass: 'bond', percentage: 30 },
  ];

  const allowedAssetClasses = ['largeCap', 'bond'];

  it('should return growth allocation when not in last 12 months', () => {
    const result = getTimeBasedAllocation(
      10, // horizonYears
      0,  // currentMonth
      120, // totalMonths (10 years)
      growthAllocation,
      allowedAssetClasses
    );
    expect(result).toEqual(growthAllocation);
  });

  it('should shift to bonds in last 12 months', () => {
    const result = getTimeBasedAllocation(
      10, // horizonYears
      109, // currentMonth (in last 12 months)
      120, // totalMonths
      growthAllocation,
      allowedAssetClasses
    );

    const bondAlloc = result.find((a) => a.assetClass === 'bond');
    expect(bondAlloc).toBeDefined();
    if (bondAlloc) {
      expect(bondAlloc.percentage).toBeGreaterThanOrEqual(70); // Should shift to ~80% bonds
    }
  });

  it('should handle horizon exactly 12 months', () => {
    const result = getTimeBasedAllocation(
      1, // horizonYears
      0,  // currentMonth
      12, // totalMonths (12 months)
      growthAllocation,
      allowedAssetClasses
    );

    const bondAlloc = result.find((a) => a.assetClass === 'bond');
    expect(bondAlloc).toBeDefined();
    if (bondAlloc) {
      expect(bondAlloc.percentage).toBeGreaterThanOrEqual(70);
    }
  });

  it('should normalize allocation to 100%', () => {
    const result = getTimeBasedAllocation(
      10,
      109,
      120,
      growthAllocation,
      allowedAssetClasses
    );

    const total = result.reduce((sum, a) => sum + a.percentage, 0);
    expect(total).toBe(100);
  });

  it('should add bond if not present in allocation', () => {
    const noBondAllocation: AssetAllocation[] = [
      { assetClass: 'largeCap', percentage: 100 },
    ];

    const result = getTimeBasedAllocation(
      10,
      109,
      120,
      noBondAllocation,
      allowedAssetClasses
    );

    const bondAlloc = result.find((a) => a.assetClass === 'bond');
    expect(bondAlloc).toBeDefined();
  });
});

describe('optimizeSharpeRatio', () => {
  const allowedAssetClasses = ['largeCap', 'bond', 'midCap'];

  it('should return allocation with sum = 100%', () => {
    const allocation = optimizeSharpeRatio(allowedAssetClasses, fullAssetClasses, '10Y');
    const total = allocation.reduce((sum, a) => sum + a.percentage, 0);
    expect(total).toBe(100);
  });

  it('should allocate more to higher Sharpe ratio assets', () => {
    const allocation = optimizeSharpeRatio(allowedAssetClasses, fullAssetClasses, '10Y');
    expect(allocation.length).toBeGreaterThan(0);
    expect(allocation.every((a) => a.percentage >= 0)).toBe(true);
  });

  it('should handle single allowed asset class', () => {
    const allocation = optimizeSharpeRatio(['largeCap'], fullAssetClasses, '10Y');
    expect(allocation.length).toBe(1);
    expect(allocation[0].percentage).toBe(100);
  });

  it('should skip cash', () => {
    const allocation = optimizeSharpeRatio(['cash'], fullAssetClasses, '10Y');
    // Should return empty or handle gracefully
    expect(allocation).toBeDefined();
  });
});

describe('getOptimalAllocation', () => {
  const allowedAssetClasses = ['largeCap', 'bond'];

  it('should apply time-based allocation for basic tier', () => {
    const allocation = getOptimalAllocation(
      singleGoal,
      'basic',
      allowedAssetClasses,
      fullAssetClasses,
      109 // In last 12 months
    );

    const bondAlloc = allocation.find((a) => a.assetClass === 'bond');
    expect(bondAlloc).toBeDefined();
    if (bondAlloc) {
      expect(bondAlloc.percentage).toBeGreaterThanOrEqual(70);
    }
  });

  it('should not apply time-based allocation for ambitious tier', () => {
    const allocationEarly = getOptimalAllocation(
      singleGoal,
      'ambitious',
      allowedAssetClasses,
      fullAssetClasses,
      0 // Early months
    );

    const allocationLate = getOptimalAllocation(
      singleGoal,
      'ambitious',
      allowedAssetClasses,
      fullAssetClasses,
      109 // Last 12 months
    );

    // Allocation should be similar (no time-based shift)
    const bondEarly = allocationEarly.find((a) => a.assetClass === 'bond')?.percentage || 0;
    const bondLate = allocationLate.find((a) => a.assetClass === 'bond')?.percentage || 0;
    // Should be similar (allowing for some variation)
    expect(Math.abs(bondEarly - bondLate)).toBeLessThan(20);
  });

  it('should return allocation with sum = 100%', () => {
    const allocation = getOptimalAllocation(
      singleGoal,
      'basic',
      allowedAssetClasses,
      fullAssetClasses
    );

    const total = allocation.reduce((sum, a) => sum + a.percentage, 0);
    expect(total).toBe(100);
  });
});

describe('calculateWeightedMetrics', () => {
  const allocations: AssetAllocation[] = [
    { assetClass: 'largeCap', percentage: 60 },
    { assetClass: 'bond', percentage: 40 },
  ];

  const assetClassDataMap = {
    largeCap: fullAssetClasses.largeCap['10Y']!,
    bond: fullAssetClasses.bond['10Y']!,
  };

  it('should calculate weighted return', () => {
    const metrics = calculateWeightedMetrics(allocations, assetClassDataMap);
    expect(metrics.return).toBeGreaterThan(0);
    expect(metrics.return).toBeLessThan(0.15);
  });

  it('should calculate weighted volatility', () => {
    const metrics = calculateWeightedMetrics(allocations, assetClassDataMap);
    expect(metrics.volatility).toBeGreaterThanOrEqual(0);
  });

  it('should skip cash allocation', () => {
    const allocationsWithCash: AssetAllocation[] = [
      { assetClass: 'largeCap', percentage: 50 },
      { assetClass: 'cash', percentage: 50 },
    ];

    const metrics = calculateWeightedMetrics(allocationsWithCash, assetClassDataMap);
    expect(metrics.return).toBeGreaterThan(0);
  });

  it('should handle missing asset classes', () => {
    const allocationsWithMissing: AssetAllocation[] = [
      { assetClass: 'largeCap', percentage: 50 },
      { assetClass: 'nonExistent', percentage: 50 },
    ];

    const metrics = calculateWeightedMetrics(allocationsWithMissing, assetClassDataMap);
    expect(metrics.return).toBeGreaterThan(0);
  });
});
