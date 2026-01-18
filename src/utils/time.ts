/**
 * Time conversion and horizon utilities for financial planning calculations.
 */

/**
 * Converts years to months, rounding to the nearest month.
 * 
 * @param years - Number of years
 * @returns Number of months (rounded)
 */
export function yearsToMonths(years: number): number {
  return Math.round(years * 12);
}

/**
 * Converts months to years as a decimal.
 * 
 * @param months - Number of months
 * @returns Number of years as a decimal
 */
export function monthsToYears(months: number): number {
  return months / 12;
}

/**
 * Determines the appropriate time horizon key based on goal horizon.
 * Used to select the correct asset class data for the goal's time horizon.
 * 
 * @param horizonYears - Goal horizon in years
 * @returns Time horizon key: "3Y" for ≤3 years, "5Y" for ≤5 years, "10Y" for >5 years
 */
export function getTimeHorizonKey(horizonYears: number): "3Y" | "5Y" | "10Y" {
  if (horizonYears <= 3) {
    return "3Y";
  } else if (horizonYears <= 5) {
    return "5Y";
  } else {
    return "10Y";
  }
}

/**
 * Checks if the current time is within the last 12 months before goal maturity.
 * Used to trigger time-based asset allocation shifts (e.g., moving to bonds).
 * 
 * @param currentMonth - Current month number (0-indexed)
 * @param totalMonths - Total months until goal maturity
 * @returns True if within the last 12 months, false otherwise
 */
export function isInLast12Months(currentMonth: number, totalMonths: number): boolean {
  return currentMonth >= totalMonths - 12;
}

/**
 * Calculates the number of months remaining until goal maturity.
 * Returns 0 if the goal has already passed.
 * 
 * @param currentMonth - Current month number (0-indexed)
 * @param totalMonths - Total months until goal maturity
 * @returns Number of months remaining (non-negative)
 */
export function monthsRemaining(currentMonth: number, totalMonths: number): number {
  return Math.max(0, totalMonths - currentMonth);
}
