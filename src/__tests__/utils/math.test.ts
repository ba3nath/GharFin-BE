import {
  annualToMonthlyReturn,
  annualToMonthlyVolatility,
  futureValue,
  futureValueOfAnnuity,
  corpusAtTime,
  requiredSIP,
  interpolate,
  roundToNearest1000,
} from '../../utils/math';

describe('annualToMonthlyReturn', () => {
  it('should convert 12% annual to 1% monthly', () => {
    expect(annualToMonthlyReturn(0.12)).toBeCloseTo(0.01, 5);
  });

  it('should convert 0% annual to 0% monthly', () => {
    expect(annualToMonthlyReturn(0)).toBe(0);
  });

  it('should convert negative annual return', () => {
    expect(annualToMonthlyReturn(-0.05)).toBeCloseTo(-0.05 / 12, 5);
  });

  it('should convert very large annual return', () => {
    expect(annualToMonthlyReturn(1.0)).toBeCloseTo(1.0 / 12, 5);
  });
});

describe('annualToMonthlyVolatility', () => {
  it('should convert 20% annual volatility to monthly using sqrt(12)', () => {
    const monthly = annualToMonthlyVolatility(0.20);
    expect(monthly).toBeCloseTo(0.20 / Math.sqrt(12), 5);
  });

  it('should convert 0% volatility to 0%', () => {
    expect(annualToMonthlyVolatility(0)).toBe(0);
  });

  it('should convert high volatility correctly', () => {
    const monthly = annualToMonthlyVolatility(0.50);
    expect(monthly).toBeCloseTo(0.50 / Math.sqrt(12), 5);
  });
});

describe('futureValue', () => {
  it('should calculate FV with positive return', () => {
    const result = futureValue(1000, 0.01, 12);
    expect(result).toBeCloseTo(1000 * Math.pow(1.01, 12), 2);
  });

  it('should calculate FV with zero return (no growth)', () => {
    expect(futureValue(1000, 0, 12)).toBe(1000);
  });

  it('should calculate FV with negative return', () => {
    const result = futureValue(1000, -0.01, 12);
    expect(result).toBeCloseTo(1000 * Math.pow(0.99, 12), 2);
  });

  it('should calculate FV with zero periods', () => {
    expect(futureValue(1000, 0.01, 0)).toBe(1000);
  });

  it('should calculate FV with large periods', () => {
    const result = futureValue(1000, 0.01, 120);
    expect(result).toBeCloseTo(1000 * Math.pow(1.01, 120), 2);
  });
});

describe('futureValueOfAnnuity', () => {
  it('should calculate FV of annuity with positive return', () => {
    const result = futureValueOfAnnuity(1000, 0.01, 12);
    const expected = 1000 * ((Math.pow(1.01, 12) - 1) / 0.01);
    expect(result).toBeCloseTo(expected, 2);
  });

  it('should calculate FV of annuity with zero return (linear growth)', () => {
    expect(futureValueOfAnnuity(1000, 0, 12)).toBe(1000 * 12);
  });

  it('should calculate FV of annuity with negative return', () => {
    const result = futureValueOfAnnuity(1000, -0.01, 12);
    const expected = 1000 * ((Math.pow(0.99, 12) - 1) / -0.01);
    expect(result).toBeCloseTo(expected, 2);
  });

  it('should return zero for zero payment', () => {
    expect(futureValueOfAnnuity(0, 0.01, 12)).toBe(0);
  });

  it('should return zero for zero periods', () => {
    expect(futureValueOfAnnuity(1000, 0.01, 0)).toBe(0);
  });
});

describe('corpusAtTime', () => {
  it('should calculate corpus with initial corpus + SIP', () => {
    const initialCorpus = 1000000;
    const monthlySIP = 50000;
    const monthlyReturn = 0.01;
    const months = 12;

    const corpusGrowth = futureValue(initialCorpus, monthlyReturn, months);
    const sipGrowth = futureValueOfAnnuity(monthlySIP, monthlyReturn, months);
    const expected = corpusGrowth + sipGrowth;

    const result = corpusAtTime(initialCorpus, monthlySIP, monthlyReturn, months);
    expect(result).toBeCloseTo(expected, 2);
  });

  it('should calculate corpus with zero initial corpus', () => {
    const result = corpusAtTime(0, 50000, 0.01, 12);
    const expected = futureValueOfAnnuity(50000, 0.01, 12);
    expect(result).toBeCloseTo(expected, 2);
  });

  it('should calculate corpus with zero SIP', () => {
    const result = corpusAtTime(1000000, 0, 0.01, 12);
    const expected = futureValue(1000000, 0.01, 12);
    expect(result).toBeCloseTo(expected, 2);
  });

  it('should calculate corpus with both zero', () => {
    expect(corpusAtTime(0, 0, 0.01, 12)).toBe(0);
  });
});

describe('requiredSIP', () => {
  it('should calculate required SIP to meet target', () => {
    const targetCorpus = 2000000;
    const initialCorpus = 1000000;
    const monthlyReturn = 0.01;
    const months = 12;

    const corpusFV = futureValue(initialCorpus, monthlyReturn, months);
    const shortfall = targetCorpus - corpusFV;
    const annuityFactor = (Math.pow(1 + monthlyReturn, months) - 1) / monthlyReturn;
    const expected = shortfall / annuityFactor;

    const result = requiredSIP(targetCorpus, initialCorpus, monthlyReturn, months);
    expect(result).toBeCloseTo(expected, 2);
  });

  it('should return 0 if target already met by corpus alone', () => {
    const targetCorpus = 1000000;
    const initialCorpus = 2000000;
    const monthlyReturn = 0.01;
    const months = 12;

    expect(requiredSIP(targetCorpus, initialCorpus, monthlyReturn, months)).toBe(0);
  });

  it('should calculate required SIP with zero return (linear)', () => {
    const targetCorpus = 2000000;
    const initialCorpus = 1000000;
    const monthlyReturn = 0;
    const months = 12;

    const result = requiredSIP(targetCorpus, initialCorpus, monthlyReturn, months);
    expect(result).toBeCloseTo((2000000 - 1000000) / 12, 2);
  });

  it('should handle negative return', () => {
    const result = requiredSIP(2000000, 1000000, -0.01, 12);
    expect(result).toBeGreaterThan(0);
  });
});

describe('interpolate', () => {
  it('should interpolate linearly between two points', () => {
    const result = interpolate(50, 0, 10, 100, 20);
    expect(result).toBe(15);
  });

  it('should return y1 when x equals x1', () => {
    expect(interpolate(0, 0, 10, 100, 20)).toBe(10);
  });

  it('should return y2 when x equals x2', () => {
    expect(interpolate(100, 0, 10, 100, 20)).toBe(20);
  });

  it('should handle x1 = x2 (division by zero)', () => {
    expect(interpolate(50, 10, 10, 10, 20)).toBe(10);
  });

  it('should interpolate outside range', () => {
    const result = interpolate(200, 0, 10, 100, 20);
    expect(result).toBeGreaterThan(20);
  });
});

describe('roundToNearest1000', () => {
  it('should round 1234 to 1000', () => {
    expect(roundToNearest1000(1234)).toBe(1000);
  });

  it('should round 1500 to 2000', () => {
    expect(roundToNearest1000(1500)).toBe(2000);
  });

  it('should round 999 to 1000', () => {
    expect(roundToNearest1000(999)).toBe(1000);
  });

  it('should round 0 to 0', () => {
    expect(roundToNearest1000(0)).toBe(0);
  });

  it('should round negative numbers', () => {
    expect(roundToNearest1000(-1234)).toBe(-1000);
    expect(roundToNearest1000(-1500)).toBe(-1000); // Math.round(-1.5) = -1
  });

  it('should round large numbers correctly', () => {
    expect(roundToNearest1000(1234567)).toBe(1235000);
  });
});
