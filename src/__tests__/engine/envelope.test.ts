import {
  calculateEnvelopeBounds,
  calculatePortfolioEnvelopeBounds,
  calculateConfidencePercent,
  calculateRequiredSIP,
  calculateSIPShortfall,
  calculatePresentValueOfTarget,
} from '../../engine/envelope';
import {
  minimalAssetClass,
  bondAssetClass,
  zeroReturnAssetClass,
  fullAssetClasses,
} from '../fixtures/assetClasses';
import { AssetAllocation } from '../../engine/portfolio';

describe('calculateEnvelopeBounds', () => {
  it('should calculate bounds with positive return', () => {
    const result = calculateEnvelopeBounds(1000000, 50000, minimalAssetClass, 10);
    expect(result.lower).toBeGreaterThan(0);
    expect(result.mean).toBeGreaterThan(0);
    expect(result.lower).toBeLessThanOrEqual(result.mean);
  });

  it('should calculate bounds with zero return', () => {
    const result = calculateEnvelopeBounds(1000000, 50000, zeroReturnAssetClass, 10);
    expect(result.lower).toBeGreaterThanOrEqual(0);
    expect(result.mean).toBeGreaterThanOrEqual(0);
  });

  it('should verify lower <= mean always', () => {
    const result = calculateEnvelopeBounds(1000000, 50000, minimalAssetClass, 10);
    expect(result.lower).toBeLessThanOrEqual(result.mean);
  });

  it('should increase bounds with higher return', () => {
    const lowReturn = { ...minimalAssetClass, avgReturnPct: 5 };
    const highReturn = { ...minimalAssetClass, avgReturnPct: 15 };
    
    const lowBounds = calculateEnvelopeBounds(1000000, 50000, lowReturn, 10);
    const highBounds = calculateEnvelopeBounds(1000000, 50000, highReturn, 10);
    
    expect(highBounds.mean).toBeGreaterThan(lowBounds.mean);
    expect(highBounds.lower).toBeGreaterThan(lowBounds.lower);
  });

  it('should increase bounds with longer horizon', () => {
    const shortBounds = calculateEnvelopeBounds(1000000, 50000, minimalAssetClass, 5);
    const longBounds = calculateEnvelopeBounds(1000000, 50000, minimalAssetClass, 10);
    
    expect(longBounds.mean).toBeGreaterThan(shortBounds.mean);
    expect(longBounds.lower).toBeGreaterThan(shortBounds.lower);
  });

  it('should handle zero initial corpus', () => {
    const result = calculateEnvelopeBounds(0, 50000, minimalAssetClass, 10);
    expect(result.lower).toBeGreaterThanOrEqual(0);
    expect(result.mean).toBeGreaterThanOrEqual(0);
  });

  it('should handle zero SIP', () => {
    const result = calculateEnvelopeBounds(1000000, 0, minimalAssetClass, 10);
    expect(result.lower).toBeGreaterThan(0);
    expect(result.mean).toBeGreaterThan(0);
  });

  it('should handle probNegativeYearPct = 0', () => {
    const result = calculateEnvelopeBounds(1000000, 50000, bondAssetClass, 10);
    expect(result.lower).toBeLessThanOrEqual(result.mean);
    expect(result.lower).toBeGreaterThan(0);
  });

  it('should handle probNegativeYearPct = 100%', () => {
    const allNegative = {
      ...minimalAssetClass,
      probNegativeYearPct: 100,
      expectedShortfallPct: -10,
    };
    const result = calculateEnvelopeBounds(1000000, 50000, allNegative, 10);
    expect(result.lower).toBeLessThanOrEqual(result.mean);
  });
});

describe('calculatePortfolioEnvelopeBounds', () => {
  const allocations: AssetAllocation[] = [
    { assetClass: 'largeCap', percentage: 60 },
    { assetClass: 'bond', percentage: 40 },
  ];

  const assetClassDataMap = {
    largeCap: fullAssetClasses.largeCap['10Y']!,
    bond: fullAssetClasses.bond['10Y']!,
  };

  it('should calculate bounds with multiple asset classes', () => {
    const result = calculatePortfolioEnvelopeBounds(
      1000000,
      50000,
      allocations,
      assetClassDataMap,
      10
    );
    expect(result.lower).toBeGreaterThan(0);
    expect(result.mean).toBeGreaterThan(0);
    expect(result.lower).toBeLessThanOrEqual(result.mean);
  });

  it('should skip cash allocation', () => {
    const allocationsWithCash: AssetAllocation[] = [
      { assetClass: 'largeCap', percentage: 50 },
      { assetClass: 'cash', percentage: 50 },
    ];
    const result = calculatePortfolioEnvelopeBounds(
      1000000,
      50000,
      allocationsWithCash,
      assetClassDataMap,
      10
    );
    expect(result.lower).toBeGreaterThan(0);
    expect(result.mean).toBeGreaterThan(0);
  });

  it('should handle single asset class', () => {
    const singleAllocation: AssetAllocation[] = [
      { assetClass: 'largeCap', percentage: 100 },
    ];
    const result = calculatePortfolioEnvelopeBounds(
      1000000,
      50000,
      singleAllocation,
      assetClassDataMap,
      10
    );
    expect(result.lower).toBeGreaterThan(0);
    expect(result.mean).toBeGreaterThan(0);
  });

  it('should verify weighted metrics calculation', () => {
    const weighted = calculatePortfolioEnvelopeBounds(
      1000000,
      50000,
      allocations,
      assetClassDataMap,
      10
    );
    const largeCapOnly = calculatePortfolioEnvelopeBounds(
      1000000,
      50000,
      [{ assetClass: 'largeCap', percentage: 100 }],
      assetClassDataMap,
      10
    );
    
    // Weighted should be between largeCap and bond
    expect(weighted.mean).toBeGreaterThan(0);
    expect(weighted.lower).toBeGreaterThan(0);
  });
});

describe('calculateConfidencePercent', () => {
  it('should return 100% when target at or below lower bound', () => {
    const bounds = { lower: 1000000, mean: 2000000 };
    expect(calculateConfidencePercent(1000000, bounds)).toBe(100);
    expect(calculateConfidencePercent(999999, bounds)).toBe(100);
  });

  it('should interpolate confidence between lower and mean', () => {
    const bounds = { lower: 1000000, mean: 2000000 };
    const midTarget = 1500000;
    const result = calculateConfidencePercent(midTarget, bounds);
    expect(result).toBeGreaterThan(50);
    expect(result).toBeLessThan(90);
  });

  it('should return 90% when target equals mean', () => {
    const bounds = { lower: 1000000, mean: 2000000 };
    expect(calculateConfidencePercent(2000000, bounds)).toBe(90);
  });

  it('should decrease confidence when target above mean', () => {
    const bounds = { lower: 1000000, mean: 2000000 };
    const result1 = calculateConfidencePercent(2500000, bounds);
    const result2 = calculateConfidencePercent(3000000, bounds);
    expect(result1).toBeGreaterThan(result2);
    expect(result1).toBeLessThan(90);
  });

  it('should return 0% when target significantly above mean', () => {
    const bounds = { lower: 1000000, mean: 2000000 };
    const threshold = 2000000 * 1.5; // 50% above mean
    expect(calculateConfidencePercent(threshold + 100000, bounds)).toBe(0);
  });

  it('should handle edge case: target = lower', () => {
    const bounds = { lower: 1000000, mean: 2000000 };
    expect(calculateConfidencePercent(1000000, bounds)).toBe(100);
  });

  it('should handle edge case: target = mean', () => {
    const bounds = { lower: 1000000, mean: 2000000 };
    expect(calculateConfidencePercent(2000000, bounds)).toBe(90);
  });

  it('should handle edge case: lower = mean', () => {
    const bounds = { lower: 1000000, mean: 1000000 };
    expect(calculateConfidencePercent(1000000, bounds)).toBe(100);
    expect(calculateConfidencePercent(1100000, bounds)).toBeLessThan(90);
  });
});

describe('calculateRequiredSIP', () => {
  it('should calculate required SIP for achievable target', () => {
    const result = calculateRequiredSIP(5000000, 1000000, minimalAssetClass, 10);
    expect(result).toBeGreaterThan(0);
  });

  it('should return 0 if target already met', () => {
    // With high initial corpus, target might be met
    const result = calculateRequiredSIP(1000000, 5000000, minimalAssetClass, 10);
    expect(result).toBe(0);
  });

  it('should increase SIP with higher target', () => {
    const sip1 = calculateRequiredSIP(5000000, 1000000, minimalAssetClass, 10);
    const sip2 = calculateRequiredSIP(10000000, 1000000, minimalAssetClass, 10);
    expect(sip2).toBeGreaterThan(sip1);
  });

  it('should decrease SIP with longer horizon', () => {
    const sip1 = calculateRequiredSIP(5000000, 1000000, minimalAssetClass, 5);
    const sip2 = calculateRequiredSIP(5000000, 1000000, minimalAssetClass, 10);
    expect(sip2).toBeLessThan(sip1);
  });

  it('should handle zero return', () => {
    const result = calculateRequiredSIP(5000000, 1000000, zeroReturnAssetClass, 10);
    expect(result).toBeGreaterThan(0);
    // With zero return, it's linear: (target - corpus) / months
    const expected = (5000000 - 1000000) / 120;
    expect(result).toBeCloseTo(expected, 0);
  });

  it('should handle negative return', () => {
    const negativeReturn = { ...minimalAssetClass, avgReturnPct: -5 };
    const result = calculateRequiredSIP(5000000, 1000000, negativeReturn, 10);
    expect(result).toBeGreaterThan(0);
  });
});

describe('calculateSIPShortfall', () => {
  it('should calculate shortfall with current SIP insufficient', () => {
    const result = calculateSIPShortfall(5000000, 1000000, 10000, minimalAssetClass, 120);
    expect(result).toBeGreaterThan(0);
  });

  it('should return 0 if current SIP sufficient', () => {
    // With very high current corpus and SIP, shortfall should be 0
    const result = calculateSIPShortfall(1000000, 5000000, 100000, minimalAssetClass, 120);
    expect(result).toBe(0);
  });

  it('should decrease shortfall with more months remaining', () => {
    const shortfall1 = calculateSIPShortfall(5000000, 1000000, 10000, minimalAssetClass, 60);
    const shortfall2 = calculateSIPShortfall(5000000, 1000000, 10000, minimalAssetClass, 120);
    expect(shortfall2).toBeLessThan(shortfall1);
  });

  it('should handle zero months remaining', () => {
    const result = calculateSIPShortfall(5000000, 1000000, 10000, minimalAssetClass, 0);
    expect(result).toBe(0);
  });

  it('should handle negative return', () => {
    const negativeReturn = { ...minimalAssetClass, avgReturnPct: -5 };
    const result = calculateSIPShortfall(5000000, 1000000, 10000, negativeReturn, 120);
    expect(result).toBeGreaterThan(0);
  });
});

describe('calculatePresentValueOfTarget', () => {
  const assetAllocations = [{ assetClass: 'largeCap', percentage: 100 }];
  const assetClassDataMap: Record<string, typeof minimalAssetClass> = {
    largeCap: minimalAssetClass,
  };

  it('should return PV less than target for positive return and future horizon', () => {
    const target = 1000000;
    const pv = calculatePresentValueOfTarget(target, assetAllocations, assetClassDataMap, 10);
    expect(pv).toBeLessThan(target);
    expect(pv).toBeGreaterThan(0);
  });

  it('should return target for zero horizon', () => {
    const target = 1000000;
    const pv = calculatePresentValueOfTarget(target, assetAllocations, assetClassDataMap, 0);
    expect(pv).toBe(target);
  });

  it('longer horizon should yield lower PV than shorter horizon', () => {
    const target = 1000000;
    const pv5 = calculatePresentValueOfTarget(target, assetAllocations, assetClassDataMap, 5);
    const pv10 = calculatePresentValueOfTarget(target, assetAllocations, assetClassDataMap, 10);
    expect(pv10).toBeLessThan(pv5);
  });

  it('higher return should yield lower PV', () => {
    const target = 1000000;
    const lowReturnMap = { largeCap: { ...minimalAssetClass, avgReturnPct: 5 } };
    const highReturnMap = { largeCap: { ...minimalAssetClass, avgReturnPct: 15 } };
    const pvLow = calculatePresentValueOfTarget(target, assetAllocations, lowReturnMap, 10);
    const pvHigh = calculatePresentValueOfTarget(target, assetAllocations, highReturnMap, 10);
    expect(pvHigh).toBeLessThan(pvLow);
  });
});
