/**
 * Financial calculation utilities for corpus and SIP projections.
 * All calculations use monthly compounding periods.
 */

/**
 * Converts an annual return percentage to an equivalent monthly return.
 * 
 * @param annualReturn - Annual return as a decimal (e.g., 0.12 for 12%)
 * @returns Monthly return as a decimal
 * 
 * @example
 * ```ts
 * annualToMonthlyReturn(0.12) // returns 0.01 (1% per month)
 * ```
 */
export function annualToMonthlyReturn(annualReturn: number): number {
  return annualReturn / 12;
}

/**
 * Converts annual volatility to monthly volatility using the square-root-of-time rule.
 * 
 * @param annualVolatility - Annual volatility as a decimal
 * @returns Monthly volatility as a decimal
 */
export function annualToMonthlyVolatility(annualVolatility: number): number {
  return annualVolatility / Math.sqrt(12);
}

/**
 * Calculates the future value of a single sum with compound interest.
 * Formula: FV = PV × (1 + r)^n
 * 
 * @param presentValue - Initial corpus amount
 * @param monthlyReturn - Monthly return rate as a decimal
 * @param periods - Number of monthly periods
 * @returns Future value of the corpus
 */
export function futureValue(
  presentValue: number,
  monthlyReturn: number,
  periods: number
): number {
  return presentValue * Math.pow(1 + monthlyReturn, periods);
}

/**
 * Calculates the future value of an annuity (SIP contributions).
 * Formula: FV = PMT × [(1 + r)^n - 1] / r
 * 
 * @param monthlyPayment - Monthly SIP contribution amount
 * @param monthlyReturn - Monthly return rate as a decimal
 * @param periods - Number of monthly periods
 * @returns Future value of all SIP contributions
 */
export function futureValueOfAnnuity(
  monthlyPayment: number,
  monthlyReturn: number,
  periods: number
): number {
  if (monthlyReturn === 0) {
    return monthlyPayment * periods;
  }
  return monthlyPayment * ((Math.pow(1 + monthlyReturn, periods) - 1) / monthlyReturn);
}

/**
 * Calculates the total corpus at a future time point using the envelope method.
 * Combines initial corpus growth with SIP contributions.
 * Formula: C(T) = C₀(1+r)^T + S·[(1+r)^T - 1]/r
 * 
 * @param initialCorpus - Starting corpus amount
 * @param monthlySIP - Monthly SIP contribution
 * @param monthlyReturn - Monthly return rate as a decimal
 * @param months - Number of months until target time
 * @returns Total corpus value at the target time
 */
export function corpusAtTime(
  initialCorpus: number,
  monthlySIP: number,
  monthlyReturn: number,
  months: number
): number {
  const corpusGrowth = futureValue(initialCorpus, monthlyReturn, months);
  const sipGrowth = futureValueOfAnnuity(monthlySIP, monthlyReturn, months);
  return corpusGrowth + sipGrowth;
}

/**
 * Calculates corpus at time T with step-up SIP where SIP increases annually.
 * SIP grows by stepUpPercent each year, accounting for different contribution amounts per year.
 * 
 * @param initialCorpus - Starting corpus amount
 * @param initialMonthlySIP - Initial monthly SIP contribution
 * @param stepUpPercent - Annual percentage increase in SIP (e.g., 10 for 10% increase)
 * @param monthlyReturn - Monthly return rate as a decimal
 * @param months - Total number of months until target time
 * @returns Total corpus value at the target time including step-up SIP growth
 */
export function corpusAtTimeWithStepUp(
  initialCorpus: number,
  initialMonthlySIP: number,
  stepUpPercent: number,
  monthlyReturn: number,
  months: number
): number {
  const corpusGrowth = futureValue(initialCorpus, monthlyReturn, months);
  
  let sipGrowth = 0;
  let currentSIP = initialMonthlySIP;
  let month = 0;
  
  while (month < months) {
    const monthsInThisYear = Math.min(12, months - month);
    // Calculate FV of SIP contributions in this year
    const sipFVThisYear = futureValueOfAnnuity(currentSIP, monthlyReturn, monthsInThisYear);
    // Future value of this year's SIP contributions at end of horizon
    const remainingMonths = months - month - monthsInThisYear;
    const sipFVAtHorizon = sipFVThisYear * (remainingMonths > 0 ? Math.pow(1 + monthlyReturn, remainingMonths) : 1);
    sipGrowth += sipFVAtHorizon;
    
    month += 12;
    // Apply step-up for next year
    if (month < months) {
      currentSIP *= (1 + stepUpPercent / 100);
    }
  }
  
  return corpusGrowth + sipGrowth;
}

/**
 * Calculates the required monthly SIP to reach a target corpus amount.
 * Solves for SIP in the corpus at time formula.
 * 
 * @param targetCorpus - Target corpus amount to achieve
 * @param initialCorpus - Starting corpus amount
 * @param monthlyReturn - Monthly return rate as a decimal
 * @param months - Number of months until target time
 * @returns Required monthly SIP amount (0 if target is already met or exceeded)
 */
export function requiredSIP(
  targetCorpus: number,
  initialCorpus: number,
  monthlyReturn: number,
  months: number
): number {
  const corpusFV = futureValue(initialCorpus, monthlyReturn, months);
  const shortfall = targetCorpus - corpusFV;
  
  if (shortfall <= 0) {
    return 0;
  }
  
  if (monthlyReturn === 0) {
    return shortfall / months;
  }
  
  const annuityFactor = (Math.pow(1 + monthlyReturn, months) - 1) / monthlyReturn;
  return shortfall / annuityFactor;
}

/**
 * Performs linear interpolation between two points.
 * Returns the y-value corresponding to x, given two reference points (x1, y1) and (x2, y2).
 * 
 * @param x - Input value to interpolate for
 * @param x1 - First reference x-coordinate
 * @param y1 - First reference y-coordinate
 * @param x2 - Second reference x-coordinate
 * @param y2 - Second reference y-coordinate
 * @returns Interpolated y-value
 */
export function interpolate(
  x: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  if (x2 === x1) {
    return y1;
  }
  return y1 + ((y2 - y1) * (x - x1)) / (x2 - x1);
}

/**
 * Rounds a number to the nearest thousand (1000).
 * Used for rounding financial amounts to the nearest ₹1000.
 * 
 * @param value - Number to round
 * @returns Value rounded to nearest 1000
 * 
 * @example
 * ```ts
 * roundToNearest1000(12500) // returns 12000
 * roundToNearest1000(12600) // returns 13000
 * ```
 */
export function roundToNearest1000(value: number): number {
  return Math.round(value / 1000) * 1000;
}
