import { calculateAvgPositiveReturn, getAssetClassData } from '../../models/AssetClass';
import {
  minimalAssetClass,
  bondAssetClass,
  probNegative100AssetClass,
  fullAssetClasses,
} from '../fixtures/assetClasses';

describe('calculateAvgPositiveReturn', () => {
  it('should calculate with probNegativeYearPct = 0 (no negative years)', () => {
    const result = calculateAvgPositiveReturn(bondAssetClass);
    expect(result).toBeCloseTo(bondAssetClass.avgReturnPct / 100, 5);
  });

  it('should calculate with normal probability (20%)', () => {
    const result = calculateAvgPositiveReturn(minimalAssetClass);
    const probNegative = minimalAssetClass.probNegativeYearPct / 100;
    const avgReturn = minimalAssetClass.avgReturnPct / 100;
    const expectedShortfall = minimalAssetClass.expectedShortfallPct / 100;
    const expected = (avgReturn - probNegative * expectedShortfall) / (1 - probNegative);
    expect(result).toBeCloseTo(expected, 5);
  });

  it('should handle probNegativeYearPct = 100% (all negative)', () => {
    const result = calculateAvgPositiveReturn(probNegative100AssetClass);
    expect(result).toBeCloseTo(probNegative100AssetClass.expectedShortfallPct / 100, 5);
  });

  it('should verify formula: avgReturn = probNegative * expectedShortfall + (1 - probNegative) * avgPositiveReturn', () => {
    const avgPositiveReturn = calculateAvgPositiveReturn(minimalAssetClass);
    const probNegative = minimalAssetClass.probNegativeYearPct / 100;
    const expectedShortfall = minimalAssetClass.expectedShortfallPct / 100;
    const avgReturn = minimalAssetClass.avgReturnPct / 100;

    const calculatedAvgReturn = probNegative * expectedShortfall + (1 - probNegative) * avgPositiveReturn;
    expect(calculatedAvgReturn).toBeCloseTo(avgReturn, 5);
  });
});

describe('getAssetClassData', () => {
  it('should get data for 3Y horizon', () => {
    const result = getAssetClassData(fullAssetClasses, 'largeCap');
    expect(result).not.toBeNull();
    expect(result?.avgReturnPct).toBe(12.0);
  });

  it('should get same data for any horizon (single CAGR per asset class)', () => {
    const result5Y = getAssetClassData(fullAssetClasses, 'largeCap');
    const result10Y = getAssetClassData(fullAssetClasses, 'largeCap');
    expect(result5Y).not.toBeNull();
    expect(result10Y).not.toBeNull();
    expect(result5Y?.avgReturnPct).toBe(12.0);
    expect(result10Y?.avgReturnPct).toBe(12.0);
  });

  it('should return null for missing asset class', () => {
    const result = getAssetClassData(fullAssetClasses, 'nonExistent');
    expect(result).toBeNull();
  });

  it('should return data for existing asset class (no time horizon in flat structure)', () => {
    const assetClassesFlat = {
      largeCap: { avgReturnPct: 11.5, probNegativeYearPct: 20, expectedShortfallPct: -17, maxDrawdownPct: -32 },
    };
    const result = getAssetClassData(assetClassesFlat, 'largeCap');
    expect(result).not.toBeNull();
    expect(result!.avgReturnPct).toBe(11.5);
  });
});
