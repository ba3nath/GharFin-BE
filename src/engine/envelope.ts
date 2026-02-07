import {
  annualToMonthlyReturn,
  corpusAtTime,
  corpusAtTimeWithStepUp,
  interpolate,
} from "../utils/math";
import { yearsToMonths } from "../utils/time";
import { AssetClassData, calculateAvgPositiveReturn } from "../models/AssetClass";

/**
 * Envelope bounds representing projected corpus range at a target time.
 * The envelope method provides probability-based bounds rather than volatility-based.
 * 
 * @property lower - Lower bound estimate (conservative scenario)
 * @property mean - Expected (mean) estimate (base scenario)
 */
export interface EnvelopeBounds {
  lower: number;
  mean: number;
}

/**
 * Calculates envelope bounds for a single asset class using probability-based modeling.
 * Uses probability of negative years and expected shortfall instead of volatility.
 * This provides more intuitive risk metrics for financial planning.
 * 
 * @param initialCorpus - Starting corpus amount
 * @param monthlySIP - Monthly SIP contribution
 * @param assetClassData - Asset class data with return and risk metrics
 * @param horizonYears - Investment horizon in years
 * @param stepUpPercent - Annual percentage increase in SIP (default: 0)
 * @returns Envelope bounds with lower and mean estimates
 */
export function calculateEnvelopeBounds(
  initialCorpus: number,
  monthlySIP: number,
  assetClassData: AssetClassData,
  horizonYears: number,
  stepUpPercent: number = 0
): EnvelopeBounds {
  const months = yearsToMonths(horizonYears);
  const avgReturn = assetClassData.avgReturnPct / 100;
  const probNegative = assetClassData.probNegativeYearPct / 100;
  const expectedShortfall = assetClassData.expectedShortfallPct / 100; // Already negative
  
  // Calculate average positive year return (needed for envelope calculations)
  const avgPositiveReturn = calculateAvgPositiveReturn(assetClassData);
  
  // Mean trajectory: use average return directly (already accounts for negative years)
  const meanAnnualReturn = avgReturn;
  const monthlyReturn = annualToMonthlyReturn(meanAnnualReturn);
  const mean = stepUpPercent > 0
    ? corpusAtTimeWithStepUp(initialCorpus, monthlySIP, stepUpPercent, monthlyReturn, months)
    : corpusAtTime(initialCorpus, monthlySIP, monthlyReturn, months);
  
  // Lower bound: Use constant probability with worst-case shortfall from JSON data
  const lowerProbNegative = probNegative;
  const lowerExpectedShortfall = expectedShortfall;
  
  // Calculate effective return with constant probability but worst-case shortfall
  const lowerAnnualReturn = lowerProbNegative * lowerExpectedShortfall + (1 - lowerProbNegative) * avgPositiveReturn;
  const lowerMonthlyReturn = annualToMonthlyReturn(lowerAnnualReturn);
  const lower = stepUpPercent > 0
    ? corpusAtTimeWithStepUp(initialCorpus, monthlySIP, stepUpPercent, lowerMonthlyReturn, months)
    : corpusAtTime(initialCorpus, monthlySIP, lowerMonthlyReturn, months);

  return { lower, mean };
}

/**
 * Calculates envelope bounds for a portfolio with multiple asset classes.
 * Combines weighted metrics from individual asset classes.
 * Uses probability-based modeling instead of volatility.
 * 
 * @param initialCorpus - Starting corpus amount
 * @param monthlySIP - Monthly SIP contribution
 * @param assetAllocations - Array of asset class allocations with percentages
 * @param assetClassDataMap - Map of asset class names to their data
 * @param horizonYears - Investment horizon in years
 * @param stepUpPercent - Annual percentage increase in SIP (default: 0)
 * @returns Envelope bounds for the portfolio
 */
export function calculatePortfolioEnvelopeBounds(
  initialCorpus: number,
  monthlySIP: number,
  assetAllocations: Array<{ assetClass: string; percentage: number }>,
  assetClassDataMap: Record<string, AssetClassData>,
  horizonYears: number,
  stepUpPercent: number = 0
): EnvelopeBounds {
  const months = yearsToMonths(horizonYears);

  // Calculate weighted portfolio metrics
  let weightedReturn = 0;
  let weightedProbNegative = 0;
  let weightedExpectedShortfall = 0;
  let totalWeight = 0;

  for (const allocation of assetAllocations) {
    // Skip cash - it has no return/risk metrics
    if (allocation.assetClass === "cash") {
      continue;
    }

    const data = assetClassDataMap[allocation.assetClass];
    if (!data) continue;

    const weight = allocation.percentage / 100;
    totalWeight += weight;

    weightedReturn += data.avgReturnPct * weight;
    weightedProbNegative += data.probNegativeYearPct * weight;
    weightedExpectedShortfall += data.expectedShortfallPct * weight;
  }

  // Normalize by total weight
  if (totalWeight > 0) {
    weightedReturn /= totalWeight;
    weightedProbNegative /= totalWeight;
    weightedExpectedShortfall /= totalWeight;
  }

  // Create synthetic asset class data for portfolio
  const portfolioData: AssetClassData = {
    avgReturnPct: weightedReturn,
    probNegativeYearPct: weightedProbNegative,
    expectedShortfallPct: weightedExpectedShortfall,
    maxDrawdownPct: 0, // Not used for envelope calculation
  };

  // Use the same logic as single asset class
  return calculateEnvelopeBounds(initialCorpus, monthlySIP, portfolioData, horizonYears, stepUpPercent);
}

/**
 * Calculates confidence percentage that a goal can be met based on envelope bounds.
 * Confidence is determined by where the target amount falls relative to the lower and mean bounds.
 * For "can_be_met" status (≥90% confidence), the lower bound must be ≥ target amount.
 * 
 * @param targetAmount - Target corpus amount required for the goal
 * @param bounds - Envelope bounds with lower and mean estimates
 * @returns Confidence percentage (0-100)
 */
export function calculateConfidencePercent(
  targetAmount: number,
  bounds: EnvelopeBounds
): number {
  const { lower, mean } = bounds;

  // If lower bound >= target, goal can be met (100% confidence)
  if (targetAmount <= lower) {
    return 100;
  }

  // If target is between lower and mean, interpolate from 50% to 90%
  if (targetAmount <= mean) {
    return interpolate(targetAmount, lower, 50, mean, 90);
  }

  // If target is above mean, confidence decreases
  // Use a conservative approach: target above mean but below threshold = at risk (50% to 0%)
  // Threshold is 50% above mean
  const threshold = mean * 1.5;
  if (targetAmount <= threshold) {
    return interpolate(targetAmount, mean, 90, threshold, 0);
  }

  // Target is significantly above mean - cannot be met
  return 0;
}

/**
 * Calculates the required monthly SIP to meet a target corpus with 90% confidence.
 * Uses probability-based modeling with the lower bound scenario.
 * For goals with step-up, uses binary search to find the required initial SIP.
 * 
 * @param targetAmount - Target corpus amount required
 * @param initialCorpus - Starting corpus amount
 * @param assetClassData - Asset class data with return and risk metrics
 * @param horizonYears - Investment horizon in years
 * @param stepUpPercent - Annual percentage increase in SIP (default: 0)
 * @returns Required monthly SIP amount
 */
export function calculateRequiredSIP(
  targetAmount: number,
  initialCorpus: number,
  assetClassData: AssetClassData,
  horizonYears: number,
  stepUpPercent: number = 0
): number {
  const months = yearsToMonths(horizonYears);
  
  // Calculate lower bound annual return using probability-based model
  const avgReturn = assetClassData.avgReturnPct / 100;
  const probNegative = assetClassData.probNegativeYearPct / 100; // Constant from JSON
  const expectedShortfall = assetClassData.expectedShortfallPct / 100; // Worst case from JSON
  const avgPositiveReturn = calculateAvgPositiveReturn(assetClassData);
  
  // Lower bound: Use constant probability with worst-case shortfall (from JSON, no modification)
  const lowerProbNegative = probNegative; // Constant - from JSON, no modification
  const lowerExpectedShortfall = expectedShortfall; // Worst case - from JSON, no modification
  const lowerAnnualReturn = lowerProbNegative * lowerExpectedShortfall + (1 - lowerProbNegative) * avgPositiveReturn;
  
  // Use lower bound return for required SIP calculation
  const rMinus = annualToMonthlyReturn(lowerAnnualReturn);

  if (stepUpPercent > 0) {
    // With step-up, use binary search to find required initial SIP
    let lowSIP = 0;
    let highSIP = targetAmount; // Upper bound: target amount as monthly SIP (unrealistic but safe)
    let iterations = 0;
    const maxIterations = 50;
    
    while (iterations < maxIterations && (highSIP - lowSIP) > 0.01) {
      const testSIP = (lowSIP + highSIP) / 2;
      const testCorpus = corpusAtTimeWithStepUp(initialCorpus, testSIP, stepUpPercent, rMinus, months);
      
      if (testCorpus >= targetAmount) {
        highSIP = testSIP;
      } else {
        lowSIP = testSIP;
      }
      iterations++;
    }
    
    return (lowSIP + highSIP) / 2;
  } else {
    // Without step-up, use simple formula
    const corpusFV = initialCorpus * Math.pow(1 + rMinus, months);
    const shortfall = targetAmount - corpusFV;

    if (shortfall <= 0) {
      return 0;
    }

    if (rMinus === 0) {
      return shortfall / months;
    }

    const annuityFactor = (Math.pow(1 + rMinus, months) - 1) / rMinus;
    return shortfall / annuityFactor;
  }
}

/**
 * Calculate minimum monthly SIP needed to achieve a target confidence using the envelope method.
 * Uses binary search to find the smallest SIP such that confidence >= targetConfidencePct.
 *
 * @param targetAmount - Target corpus amount required
 * @param initialCorpus - Starting corpus amount
 * @param assetAllocations - Asset allocation configuration
 * @param assetClassDataMap - Map of asset class names to their data
 * @param horizonYears - Investment horizon in years
 * @param targetConfidencePct - Target confidence percentage (default 90)
 * @param maxIterations - Maximum binary search iterations
 * @param stepUpPercent - Annual percentage increase in SIP (default 0)
 * @returns Minimum monthly SIP to achieve target confidence
 */
export function calculateMinimumSIPForConfidenceEnvelope(
  targetAmount: number,
  initialCorpus: number,
  assetAllocations: Array<{ assetClass: string; percentage: number }>,
  assetClassDataMap: Record<string, AssetClassData>,
  horizonYears: number,
  targetConfidencePct: number = 90,
  maxIterations: number = 50,
  stepUpPercent: number = 0
): number {
  const boundsWithZero = calculatePortfolioEnvelopeBounds(
    initialCorpus,
    0,
    assetAllocations,
    assetClassDataMap,
    horizonYears,
    stepUpPercent
  );
  const confidenceWithZero = calculateConfidencePercent(targetAmount, boundsWithZero);
  if (confidenceWithZero >= targetConfidencePct) {
    return 0;
  }

  let lowSIP = 0;
  let highSIP = targetAmount;
  const tolerance = 100;
  let iterations = 0;

  while (highSIP - lowSIP > tolerance && iterations < maxIterations) {
    iterations++;
    const testSIP = (lowSIP + highSIP) / 2;

    const bounds = calculatePortfolioEnvelopeBounds(
      initialCorpus,
      testSIP,
      assetAllocations,
      assetClassDataMap,
      horizonYears,
      stepUpPercent
    );
    const confidence = calculateConfidencePercent(targetAmount, bounds);

    if (confidence >= targetConfidencePct) {
      highSIP = testSIP;
    } else {
      lowSIP = testSIP;
    }
  }

  return Math.ceil(highSIP / 1000) * 1000;
}

/**
 * Calculate minimum corpus needed to achieve a target confidence using envelope method.
 * Binary search over corpus with fixed SIP. Returns minimum total corpus.
 *
 * @param targetAmount - Target corpus amount required
 * @param monthlySIP - Fixed monthly SIP
 * @param referenceCorpusTotal - Reference total corpus (used for upper bound)
 * @param assetAllocations - Asset allocation configuration
 * @param assetClassDataMap - Map of asset class names to their data
 * @param horizonYears - Investment horizon in years
 * @param targetConfidencePct - Target confidence percentage (default 90)
 * @param maxIterations - Maximum binary search iterations
 * @param stepUpPercent - Annual percentage increase in SIP (default 0)
 * @returns Minimum total corpus to achieve target confidence
 */
export function calculateMinimumCorpusForConfidenceEnvelope(
  targetAmount: number,
  monthlySIP: number,
  referenceCorpusTotal: number,
  assetAllocations: Array<{ assetClass: string; percentage: number }>,
  assetClassDataMap: Record<string, AssetClassData>,
  horizonYears: number,
  targetConfidencePct: number = 90,
  maxIterations: number = 50,
  stepUpPercent: number = 0
): number {
  const highBound = Math.max(referenceCorpusTotal * 2, targetAmount);
  let lowCorpus = 0;
  let highCorpus = highBound;
  const tolerance = 1000;
  let iterations = 0;

  while (highCorpus - lowCorpus > tolerance && iterations < maxIterations) {
    iterations++;
    const testCorpus = (lowCorpus + highCorpus) / 2;

    const bounds = calculatePortfolioEnvelopeBounds(
      testCorpus,
      monthlySIP,
      assetAllocations,
      assetClassDataMap,
      horizonYears,
      stepUpPercent
    );
    const confidence = calculateConfidencePercent(targetAmount, bounds);

    if (confidence >= targetConfidencePct) {
      highCorpus = testCorpus;
    } else {
      lowCorpus = testCorpus;
    }
  }

  return Math.round(highCorpus);
}

/**
 * Calculates the present value of a target amount, i.e. how much corpus is needed today
 * to grow to the target at the goal horizon with zero SIP. Uses the expected (mean) portfolio
 * return. This enables corpus allocation to consider growth: goals with longer horizons
 * need less corpus per rupee of target than goals with shorter horizons.
 *
 * @param targetAmount - Target corpus amount required at goal horizon
 * @param assetAllocations - Asset allocation for the goal
 * @param assetClassDataMap - Map of asset class names to their data
 * @param horizonYears - Investment horizon in years
 * @returns Present value of the target (corpus needed today)
 */
export function calculatePresentValueOfTarget(
  targetAmount: number,
  assetAllocations: Array<{ assetClass: string; percentage: number }>,
  assetClassDataMap: Record<string, AssetClassData>,
  horizonYears: number
): number {
  const months = yearsToMonths(horizonYears);
  if (months <= 0) return targetAmount;

  let weightedReturn = 0;
  let totalWeight = 0;

  for (const allocation of assetAllocations) {
    if (allocation.assetClass === "cash") continue;

    const data = assetClassDataMap[allocation.assetClass];
    if (!data) continue;

    const weight = allocation.percentage / 100;
    totalWeight += weight;
    weightedReturn += (data.avgReturnPct / 100) * weight;
  }

  if (totalWeight <= 0) return targetAmount;

  const annualReturn = weightedReturn / totalWeight;
  const monthlyReturn = annualToMonthlyReturn(annualReturn);

  // PV = FV / (1 + r)^n
  const pv = targetAmount / Math.pow(1 + monthlyReturn, months);
  return Math.max(0, pv);
}

/**
 * Calculates the additional SIP required to meet a target after accounting for current progress.
 * Uses probability-based modeling with the lower bound scenario.
 * 
 * @param targetAmount - Target corpus amount required
 * @param currentCorpus - Current corpus amount
 * @param currentSIP - Current monthly SIP contribution
 * @param assetClassData - Asset class data with return and risk metrics
 * @param monthsRemaining - Number of months remaining until goal
 * @returns Additional monthly SIP required (0 if target is already met)
 */
export function calculateSIPShortfall(
  targetAmount: number,
  currentCorpus: number,
  currentSIP: number,
  assetClassData: AssetClassData,
  monthsRemaining: number
): number {
  // Calculate lower bound annual return using probability-based model
  const avgReturn = assetClassData.avgReturnPct / 100;
  const probNegative = assetClassData.probNegativeYearPct / 100; // Constant from JSON
  const expectedShortfall = assetClassData.expectedShortfallPct / 100; // Worst case from JSON
  const avgPositiveReturn = calculateAvgPositiveReturn(assetClassData);
  
  // Lower bound: Use constant probability with worst-case shortfall (from JSON, no modification)
  const lowerProbNegative = probNegative; // Constant - from JSON, no modification
  const lowerExpectedShortfall = expectedShortfall; // Worst case - from JSON, no modification
  const lowerAnnualReturn = lowerProbNegative * lowerExpectedShortfall + (1 - lowerProbNegative) * avgPositiveReturn;
  
  const rMinus = annualToMonthlyReturn(lowerAnnualReturn);

  // Project current corpus with current SIP
  const projectedCorpus = corpusAtTime(
    currentCorpus,
    currentSIP,
    rMinus,
    monthsRemaining
  );

  const shortfall = targetAmount - projectedCorpus;

  if (shortfall <= 0) {
    return 0;
  }

  // Calculate additional SIP needed
  if (monthsRemaining <= 0) {
    return 0;
  }
  
  if (rMinus === 0) {
    return shortfall / monthsRemaining;
  }

  const annuityFactor = (Math.pow(1 + rMinus, monthsRemaining) - 1) / rMinus;
  return shortfall / annuityFactor;
}
