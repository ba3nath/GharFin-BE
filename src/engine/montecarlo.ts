import {
  annualToMonthlyReturn,
  annualToMonthlyVolatility,
  futureValue,
  futureValueOfAnnuity,
} from "../utils/math";
import { yearsToMonths } from "../utils/time";
import { AssetAllocation } from "./portfolio";
import { AssetClassData, calculateAvgPositiveReturn } from "../models/AssetClass";
import { EnvelopeBounds } from "./envelope";

/**
 * Monte Carlo simulation parameters
 */
const SIMULATION_COUNT_LITE = 75; // Monte Carlo lite: 50-100 paths (for validation)
const SIMULATION_COUNT_METHOD2 = 1000; // Method 2: 1000 paths for planning

/**
 * Single simulation path result
 */
export interface SimulationPath {
  finalCorpus: number;
  monthlyValues: number[];
}

/**
 * Monte Carlo validation result
 */
export interface MonteCarloValidation {
  containmentPercent: number;
  lowerTailAligned: boolean;
  meanAligned: boolean;
  paths: SimulationPath[];
  averagePath: number;
  isValid: boolean;
}

/**
 * Generate normal random number using Box-Muller transform
 */
function generateNormalRandom(): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return z0;
}

/**
 * Generate random monthly return based on probability of negative years (for Method 1 validation)
 * Returns positive return or negative shortfall based on probNegativeYearPct
 */
function generateRandomReturnProbability(
  avgReturn: number,
  probNegative: number,
  expectedShortfall: number,
  avgPositiveReturn: number
): number {
  // Determine if this period (month) will be negative based on annual probability
  // Approximate monthly probability
  const monthlyProbNegative = 1 - Math.pow(1 - probNegative, 1 / 12);
  
  if (Math.random() < monthlyProbNegative) {
    // Negative month - use expected shortfall (scaled to monthly)
    return expectedShortfall / 12;
  } else {
    // Positive month - use average positive return (scaled to monthly)
    return avgPositiveReturn / 12;
  }
}

/**
 * Generate random monthly return using lognormal distribution with volatility (for Method 2)
 * log(1 + r) ~ N(log(1 + μ_monthly), σ_monthly²)
 */
function generateRandomReturnLognormal(
  avgReturn: number,
  volatility: number
): number {
  const monthlyReturn = avgReturn / 12;
  const monthlyVolatility = volatility / Math.sqrt(12);
  
  // Lognormal: log(1 + r) ~ N(log(1 + μ_monthly), σ_monthly²)
  const logMean = Math.log(1 + monthlyReturn);
  const z = generateNormalRandom();
  const logReturn = logMean + monthlyVolatility * z;
  const return_ = Math.exp(logReturn) - 1;
  
  return return_;
}

/**
 * Run single Monte Carlo simulation path using probability-based modeling (for Method 1 validation)
 */
function simulatePathProbability(
  initialCorpus: number,
  monthlySIP: number,
  assetClassData: AssetClassData,
  months: number
): SimulationPath {
  let corpus = initialCorpus;
  const monthlyValues: number[] = [corpus];

  const avgReturn = assetClassData.avgReturnPct / 100;
  const probNegative = assetClassData.probNegativeYearPct / 100;
  const expectedShortfall = assetClassData.expectedShortfallPct / 100;
  const avgPositiveReturn = calculateAvgPositiveReturn(assetClassData);

  for (let month = 0; month < months; month++) {
    // Generate random return for this month based on probability
    const randomReturn = generateRandomReturnProbability(
      avgReturn,
      probNegative,
      expectedShortfall,
      avgPositiveReturn
    );
    
    // Apply return to existing corpus
    corpus = corpus * (1 + randomReturn);
    
    // Add SIP at end of month
    corpus += monthlySIP;
    
    monthlyValues.push(corpus);
  }

  return {
    finalCorpus: corpus,
    monthlyValues,
  };
}

/**
 * Run single Monte Carlo simulation path using lognormal distribution (for Method 2)
 * Tracks corpus and SIP growth by asset class
 */
function simulatePathLognormal(
  initialCorpusByAssetClass: Record<string, number>,
  monthlySIPByAssetClass: Record<string, number>,
  assetAllocations: AssetAllocation[],
  assetClassDataMap: Record<string, AssetClassData>,
  months: number,
  stepUpPercent: number = 0
): SimulationPath {
  // Initialize corpus by asset class
  const corpusByAssetClass: Record<string, number> = { ...initialCorpusByAssetClass };
  const monthlyValues: number[] = [Object.values(corpusByAssetClass).reduce((sum, v) => sum + v, 0)];
  
  // Track current SIP by asset class (will grow with step-up)
  const currentSIPByAssetClass: Record<string, number> = { ...monthlySIPByAssetClass };

  for (let month = 0; month < months; month++) {
    // Apply step-up at the start of each year (after month 0)
    if (month > 0 && month % 12 === 0 && stepUpPercent > 0) {
      for (const assetClass in currentSIPByAssetClass) {
        currentSIPByAssetClass[assetClass] *= (1 + stepUpPercent / 100);
      }
    }
    
    // Generate returns for each asset class independently
    for (const allocation of assetAllocations) {
      if (allocation.assetClass === "cash") {
        continue; // Cash has no return
      }

      const data = assetClassDataMap[allocation.assetClass];
      if (!data || !data.volatilityPct) {
        throw new Error(`volatilityPct is required for asset class ${allocation.assetClass} in Method 2`);
      }

      const avgReturn = data.avgReturnPct / 100;
      const volatility = data.volatilityPct / 100;
      
      // Generate lognormal return for this asset class
      const randomReturn = generateRandomReturnLognormal(avgReturn, volatility);
      
      // Grow corpus for this asset class
      if (corpusByAssetClass[allocation.assetClass] !== undefined) {
        corpusByAssetClass[allocation.assetClass] *= (1 + randomReturn);
      }
      
      // Grow SIP allocation for this asset class and add to corpus
      if (currentSIPByAssetClass[allocation.assetClass] !== undefined) {
        const sipAmount = currentSIPByAssetClass[allocation.assetClass];
        corpusByAssetClass[allocation.assetClass] = (corpusByAssetClass[allocation.assetClass] || 0) + sipAmount;
      }
    }
    
    // Calculate total corpus
    const totalCorpus = Object.values(corpusByAssetClass).reduce((sum, v) => sum + v, 0);
    monthlyValues.push(totalCorpus);
  }

  const finalCorpus = Object.values(corpusByAssetClass).reduce((sum, v) => sum + v, 0);

  return {
    finalCorpus,
    monthlyValues,
  };
}

/**
 * Run Monte Carlo simulation for single asset class using probability-based modeling (for Method 1 validation)
 */
export function runMonteCarloSimulation(
  initialCorpus: number,
  monthlySIP: number,
  assetClassData: AssetClassData,
  horizonYears: number
): SimulationPath[] {
  const months = yearsToMonths(horizonYears);

  const paths: SimulationPath[] = [];
  for (let i = 0; i < SIMULATION_COUNT_LITE; i++) {
    paths.push(
      simulatePathProbability(
        initialCorpus,
        monthlySIP,
        assetClassData,
        months
      )
    );
  }

  return paths;
}

/**
 * Run Monte Carlo simulation for portfolio using lognormal distribution (for Method 2)
 * Tracks corpus and SIP growth by asset class
 */
export function runPortfolioMonteCarloSimulationLognormal(
  initialCorpusByAssetClass: Record<string, number>,
  monthlySIPByAssetClass: Record<string, number>,
  allocations: AssetAllocation[],
  assetClassDataMap: Record<string, AssetClassData>,
  horizonYears: number,
  simulationPaths: number = SIMULATION_COUNT_METHOD2,
  stepUpPercent: number = 0
): SimulationPath[] {
  const months = yearsToMonths(horizonYears);

  // Validate volatilityPct is present for all asset classes
  for (const allocation of allocations) {
    if (allocation.assetClass === "cash") continue;
    const data = assetClassDataMap[allocation.assetClass];
    if (data && !data.volatilityPct) {
      throw new Error(`volatilityPct is required for asset class ${allocation.assetClass} in Method 2`);
    }
  }

  const paths: SimulationPath[] = [];
  for (let i = 0; i < simulationPaths; i++) {
    paths.push(
      simulatePathLognormal(
        initialCorpusByAssetClass,
        monthlySIPByAssetClass,
        allocations,
        assetClassDataMap,
        months,
        stepUpPercent
      )
    );
  }

  return paths;
}

/**
 * Run Monte Carlo simulation for portfolio (multiple asset classes)
 * Uses probability-based modeling
 */
export function runPortfolioMonteCarloSimulation(
  initialCorpus: number,
  monthlySIP: number,
  allocations: AssetAllocation[],
  assetClassDataMap: Record<string, AssetClassData>,
  horizonYears: number
): SimulationPath[] {
  const months = yearsToMonths(horizonYears);

  // Calculate weighted portfolio metrics
  let weightedReturn = 0;
  let weightedProbNegative = 0;
  let weightedExpectedShortfall = 0;
  let totalWeight = 0;

  for (const allocation of allocations) {
    // Skip cash - it has no return/risk metrics
    if (allocation.assetClass === "cash") {
      continue;
    }

    const data = assetClassDataMap[allocation.assetClass];
    if (!data) continue;

    const weight = allocation.percentage / 100;
    totalWeight += weight;

    weightedReturn += (data.avgReturnPct / 100) * weight;
    weightedProbNegative += (data.probNegativeYearPct / 100) * weight;
    weightedExpectedShortfall += (data.expectedShortfallPct / 100) * weight;
  }

  // Normalize by total weight
  if (totalWeight > 0) {
    weightedReturn /= totalWeight;
    weightedProbNegative /= totalWeight;
    weightedExpectedShortfall /= totalWeight;
  }

  // Create synthetic asset class data for portfolio
  const portfolioData: AssetClassData = {
    avgReturnPct: weightedReturn * 100,
    probNegativeYearPct: weightedProbNegative * 100,
    expectedShortfallPct: weightedExpectedShortfall * 100,
    maxDrawdownPct: 0, // Not used for Monte Carlo
  };

  const paths: SimulationPath[] = [];
  for (let i = 0; i < SIMULATION_COUNT_LITE; i++) {
    paths.push(
      simulatePathProbability(
        initialCorpus,
        monthlySIP,
        portfolioData,
        months
      )
    );
  }

  return paths;
}

/**
 * Validate envelope method using Monte Carlo simulation
 */
export function validateEnvelope(
  initialCorpus: number,
  monthlySIP: number,
  allocations: AssetAllocation[],
  assetClassDataMap: Record<string, AssetClassData>,
  horizonYears: number,
  envelopeBounds: EnvelopeBounds
): MonteCarloValidation {
  const paths = runPortfolioMonteCarloSimulation(
    initialCorpus,
    monthlySIP,
    allocations,
    assetClassDataMap,
    horizonYears
  );

  const finalCorpusValues = paths.map((p) => p.finalCorpus);
  const { lower, mean } = envelopeBounds;

  // Check containment: how many paths are >= lower
  // Since upper bound is removed, we check if paths are >= lower
  const containedPaths = finalCorpusValues.filter(
    (value) => value >= lower
  ).length;
  const containmentPercent = (containedPaths / paths.length) * 100;

  // Check lower tail alignment: worst paths should trace lower envelope
  const sortedValues = [...finalCorpusValues].sort((a, b) => a - b);
  const worst10Percent = sortedValues.slice(0, Math.floor(paths.length * 0.1));
  const worstAverage = worst10Percent.reduce((sum, v) => sum + v, 0) / worst10Percent.length;
  const lowerTailAligned = Math.abs(worstAverage - lower) / lower < 0.15; // Within 15%

  // Check mean alignment: average of paths should track mean
  const averagePath = finalCorpusValues.reduce((sum, v) => sum + v, 0) / paths.length;
  const meanAligned = Math.abs(averagePath - mean) / mean < 0.1; // Within 10%

  // Validation passes if containment >= 70% and alignments are good
  // Adjusted threshold for containment since we only check lower bound
  const isValid = containmentPercent >= 70 && lowerTailAligned && meanAligned;

  return {
    containmentPercent,
    lowerTailAligned,
    meanAligned,
    paths,
    averagePath,
    isValid,
  };
}

/**
 * Calculate bounds (lower, mean) from Monte Carlo paths using statistics
 */
export function calculateMonteCarloBounds(
  paths: SimulationPath[]
): { lower: number; mean: number } {
  const finalValues = paths.map((p) => p.finalCorpus);
  const mean = finalValues.reduce((sum, v) => sum + v, 0) / finalValues.length;
  
  // Calculate standard deviation
  const variance = finalValues.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / finalValues.length;
  const std = Math.sqrt(variance);
  
  // Lower bound: mean - 1.65 * std (90% confidence, one-tailed)
  const lower = mean - 1.65 * std;
  
  return { lower, mean };
}

/**
 * Calculate confidence percentage from Monte Carlo paths
 * Returns percentage of paths where final corpus >= target amount
 */
export function calculateMonteCarloConfidence(
  paths: SimulationPath[],
  targetAmount: number
): number {
  const finalValues = paths.map((p) => p.finalCorpus);
  const pathsMeetingTarget = finalValues.filter((v) => v >= targetAmount).length;
  return Math.round((pathsMeetingTarget / finalValues.length) * 100);
}

/**
 * Calculate required monthly SIP using binary search with Monte Carlo simulation
 * Finds SIP amount where lower bound >= target amount
 */
export function calculateRequiredSIPMonteCarlo(
  targetAmount: number,
  initialCorpusByAssetClass: Record<string, number>,
  assetAllocations: AssetAllocation[],
  assetClassDataMap: Record<string, AssetClassData>,
  horizonYears: number,
  simulationPaths: number = SIMULATION_COUNT_METHOD2,
  maxIterations: number = 50,
  stepUpPercent: number = 0
): number {
  // Validate volatilityPct is present
  for (const allocation of assetAllocations) {
    if (allocation.assetClass === "cash") continue;
    const data = assetClassDataMap[allocation.assetClass];
    if (data && !data.volatilityPct) {
      throw new Error(`volatilityPct is required for asset class ${allocation.assetClass} in Method 2`);
    }
  }

  // Calculate total initial corpus
  const totalInitialCorpus = Object.values(initialCorpusByAssetClass).reduce((sum, v) => sum + v, 0);

  if (totalInitialCorpus >= targetAmount) {
    return 0;
  }
  
  // If corpus alone is sufficient, return 0
  const testPaths = runPortfolioMonteCarloSimulationLognormal(
    initialCorpusByAssetClass,
    {}, // No SIP
    assetAllocations,
    assetClassDataMap,
    horizonYears,
    simulationPaths,
    stepUpPercent
  );
  const testBounds = calculateMonteCarloBounds(testPaths);
  if (testBounds.lower >= targetAmount) {
    return 0;
  }

  // Binary search bounds
  let lowSIP = 0;
  let highSIP = targetAmount; // Upper bound estimate (target / months is too conservative, use target as upper bound)
  const tolerance = 100; // ₹100 tolerance
  
  let iterations = 0;
  
  while (highSIP - lowSIP > tolerance && iterations < maxIterations) {
    iterations++;
    const testSIP = (lowSIP + highSIP) / 2;
    
    // Calculate SIP allocation by asset class
    const monthlySIPByAssetClass: Record<string, number> = {};
    for (const allocation of assetAllocations) {
      if (allocation.assetClass === "cash") continue;
      monthlySIPByAssetClass[allocation.assetClass] = (testSIP * allocation.percentage) / 100;
    }
    
    // Run Monte Carlo simulation
    const paths = runPortfolioMonteCarloSimulationLognormal(
      initialCorpusByAssetClass,
      monthlySIPByAssetClass,
      assetAllocations,
      assetClassDataMap,
      horizonYears,
      simulationPaths,
      stepUpPercent
    );
    
    const bounds = calculateMonteCarloBounds(paths);
    
    if (bounds.lower >= targetAmount) {
      highSIP = testSIP; // Can meet target with less SIP
    } else {
      lowSIP = testSIP; // Need more SIP
    }
  }
  
  // Round up to nearest 1000
  return Math.ceil(highSIP / 1000) * 1000;
}
