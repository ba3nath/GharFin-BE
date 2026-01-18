import {
  yearsToMonths,
  getTimeHorizonKey,
  isInLast12Months,
  monthsRemaining,
} from '../../utils/time';

describe('yearsToMonths', () => {
  it('should convert 1 year to 12 months', () => {
    expect(yearsToMonths(1)).toBe(12);
  });

  it('should convert 0.5 years to 6 months', () => {
    expect(yearsToMonths(0.5)).toBe(6);
  });

  it('should convert 10 years to 120 months', () => {
    expect(yearsToMonths(10)).toBe(120);
  });

  it('should convert fractional years', () => {
    expect(yearsToMonths(2.5)).toBe(30);
    expect(yearsToMonths(7.5)).toBe(90);
  });

  it('should convert 0 years to 0 months', () => {
    expect(yearsToMonths(0)).toBe(0);
  });
});

describe('getTimeHorizonKey', () => {
  it('should return "3Y" for horizon <= 3 years', () => {
    expect(getTimeHorizonKey(1)).toBe('3Y');
    expect(getTimeHorizonKey(3)).toBe('3Y');
    expect(getTimeHorizonKey(2.5)).toBe('3Y');
  });

  it('should return "5Y" for horizon > 3 and <= 5 years', () => {
    expect(getTimeHorizonKey(4)).toBe('5Y');
    expect(getTimeHorizonKey(5)).toBe('5Y');
    expect(getTimeHorizonKey(4.5)).toBe('5Y');
  });

  it('should return "10Y" for horizon > 5 years', () => {
    expect(getTimeHorizonKey(6)).toBe('10Y');
    expect(getTimeHorizonKey(10)).toBe('10Y');
    expect(getTimeHorizonKey(15)).toBe('10Y');
  });
});

describe('isInLast12Months', () => {
  it('should return true when in last 12 months', () => {
    expect(isInLast12Months(109, 120)).toBe(true);
    expect(isInLast12Months(119, 120)).toBe(true);
    expect(isInLast12Months(120, 120)).toBe(true);
  });

  it('should return false when not in last 12 months', () => {
    expect(isInLast12Months(0, 120)).toBe(false);
    expect(isInLast12Months(100, 120)).toBe(false);
    expect(isInLast12Months(107, 120)).toBe(false);
  });

  it('should handle short horizons', () => {
    expect(isInLast12Months(0, 6)).toBe(true);
    expect(isInLast12Months(5, 6)).toBe(true);
    expect(isInLast12Months(6, 6)).toBe(true);
  });

  it('should handle horizon exactly 12 months', () => {
    expect(isInLast12Months(0, 12)).toBe(true);
    expect(isInLast12Months(11, 12)).toBe(true);
    expect(isInLast12Months(12, 12)).toBe(true);
  });
});

describe('monthsRemaining', () => {
  it('should calculate months remaining correctly', () => {
    expect(monthsRemaining(0, 120)).toBe(120);
    expect(monthsRemaining(60, 120)).toBe(60);
    expect(monthsRemaining(119, 120)).toBe(1);
    expect(monthsRemaining(120, 120)).toBe(0);
  });

  it('should return 0 if currentMonth >= totalMonths', () => {
    expect(monthsRemaining(120, 120)).toBe(0);
    expect(monthsRemaining(121, 120)).toBe(0);
  });

  it('should handle short horizons', () => {
    expect(monthsRemaining(0, 12)).toBe(12);
    expect(monthsRemaining(6, 12)).toBe(6);
    expect(monthsRemaining(12, 12)).toBe(0);
  });
});
