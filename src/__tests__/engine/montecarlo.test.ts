import {
  runPortfolioMonteCarloSimulationLognormal,
  calculateMonteCarloBounds,
  calculateMonteCarloConfidence,
  calculateRequiredSIPMonteCarlo,
  calculateMinimumSIPForConfidenceMonteCarlo,
  validateEnvelope,
} from '../../engine/montecarlo';
import {
  assetClassWithVolatility,
  bondAssetClass,
  fullAssetClasses,
} from '../fixtures/assetClasses';
import { AssetAllocation } from '../../engine/portfolio';
import { EnvelopeBounds } from '../../engine/envelope';

describe('runPortfolioMonteCarloSimulationLognormal', () => {
  const allocations: AssetAllocation[] = [
    { assetClass: 'largeCap', percentage: 100 },
  ];

  const assetClassDataMap = {
    largeCap: fullAssetClasses.largeCap['10Y']!,
  };

  const initialCorpusByAssetClass = {
    largeCap: 1000000,
  };

  const monthlySIPByAssetClass = {
    largeCap: 50000,
  };

  it('should run simulation and generate paths', () => {
    const paths = runPortfolioMonteCarloSimulationLognormal(
      initialCorpusByAssetClass,
      monthlySIPByAssetClass,
      allocations,
      assetClassDataMap,
      10,
      100 // Use fewer paths for faster tests
    );
    
    expect(paths.length).toBe(100);
    expect(paths[0].finalCorpus).toBeGreaterThan(0);
    expect(paths[0].monthlyValues).toBeDefined();
    expect(paths[0].monthlyValues.length).toBeGreaterThan(0);
  });

  it('should throw error if volatilityPct missing', () => {
    const dataWithoutVolatility = {
      ...fullAssetClasses.largeCap['10Y']!,
    };
    delete (dataWithoutVolatility as any).volatilityPct;
    
    const assetClassDataMapInvalid = {
      largeCap: dataWithoutVolatility,
    };

    expect(() => {
      runPortfolioMonteCarloSimulationLognormal(
        initialCorpusByAssetClass,
        monthlySIPByAssetClass,
        allocations,
        assetClassDataMapInvalid,
        10,
        10
      );
    }).toThrow();
  });

  it('should handle zero initial corpus', () => {
    const zeroCorpus = { largeCap: 0 };
    const paths = runPortfolioMonteCarloSimulationLognormal(
      zeroCorpus,
      monthlySIPByAssetClass,
      allocations,
      assetClassDataMap,
      10,
      10
    );
    
    expect(paths.length).toBe(10);
    expect(paths[0].finalCorpus).toBeGreaterThan(0); // SIP should grow corpus
  });

  it('should handle zero SIP', () => {
    const zeroSIP = { largeCap: 0 };
    const paths = runPortfolioMonteCarloSimulationLognormal(
      initialCorpusByAssetClass,
      zeroSIP,
      allocations,
      assetClassDataMap,
      10,
      10
    );
    
    expect(paths.length).toBe(10);
    expect(paths[0].finalCorpus).toBeGreaterThan(0); // Corpus should grow
  });

  it('should track per-asset-class growth', () => {
    const multiAssetAllocations: AssetAllocation[] = [
      { assetClass: 'largeCap', percentage: 60 },
      { assetClass: 'bond', percentage: 40 },
    ];

    const multiAssetDataMap = {
      largeCap: fullAssetClasses.largeCap['10Y']!,
      bond: fullAssetClasses.bond['10Y']!,
    };

    const multiInitialCorpus = {
      largeCap: 600000,
      bond: 400000,
    };

    const multiSIP = {
      largeCap: 30000,
      bond: 20000,
    };

    const paths = runPortfolioMonteCarloSimulationLognormal(
      multiInitialCorpus,
      multiSIP,
      multiAssetAllocations,
      multiAssetDataMap,
      10,
      10
    );
    
    expect(paths.length).toBe(10);
    expect(paths[0].finalCorpus).toBeGreaterThan(0);
  });
});

describe('calculateMonteCarloBounds', () => {
  it('should calculate bounds from paths', () => {
    // Create mock paths with known distribution
    const mockPaths = Array.from({ length: 1000 }, (_, i) => ({
      finalCorpus: 1000000 + (i - 500) * 100, // Mean around 1M, spread
      monthlyValues: [],
    }));

    const bounds = calculateMonteCarloBounds(mockPaths);
    
    expect(bounds.lower).toBeDefined();
    expect(bounds.mean).toBeDefined();
    expect(bounds.lower).toBeLessThan(bounds.mean);
  });

  it('should verify lower = mean - 1.65 * std', () => {
    const mockPaths = Array.from({ length: 1000 }, (_, i) => ({
      finalCorpus: 1000000 + (i - 500) * 100,
      monthlyValues: [],
    }));

    const bounds = calculateMonteCarloBounds(mockPaths);
    const finalValues = mockPaths.map((p) => p.finalCorpus);
    const mean = finalValues.reduce((sum, v) => sum + v, 0) / finalValues.length;
    const variance = finalValues.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / finalValues.length;
    const std = Math.sqrt(variance);
    const expectedLower = mean - 1.65 * std;

    expect(bounds.mean).toBeCloseTo(mean, 2);
    expect(bounds.lower).toBeCloseTo(expectedLower, 2);
  });

  it('should handle edge case: all paths identical', () => {
    const identicalPaths = Array.from({ length: 100 }, () => ({
      finalCorpus: 1000000,
      monthlyValues: [],
    }));

    const bounds = calculateMonteCarloBounds(identicalPaths);
    expect(bounds.lower).toBe(1000000);
    expect(bounds.mean).toBe(1000000);
  });
});

describe('calculateMonteCarloConfidence', () => {
  it('should calculate confidence as percentage of paths meeting target', () => {
    const mockPaths = [
      { finalCorpus: 1000000, monthlyValues: [] },
      { finalCorpus: 2000000, monthlyValues: [] },
      { finalCorpus: 1500000, monthlyValues: [] },
      { finalCorpus: 2500000, monthlyValues: [] },
      { finalCorpus: 1800000, monthlyValues: [] },
    ];

    const confidence = calculateMonteCarloConfidence(mockPaths, 1500000);
    // 4 out of 5 paths meet target (>= 1500000): 2000000, 1500000, 2500000, 1800000 = 80%
    expect(confidence).toBe(80);
  });

  it('should return 100% when all paths meet target', () => {
    const mockPaths = Array.from({ length: 10 }, () => ({
      finalCorpus: 2000000,
      monthlyValues: [],
    }));

    const confidence = calculateMonteCarloConfidence(mockPaths, 1000000);
    expect(confidence).toBe(100);
  });

  it('should return 0% when no paths meet target', () => {
    const mockPaths = Array.from({ length: 10 }, () => ({
      finalCorpus: 1000000,
      monthlyValues: [],
    }));

    const confidence = calculateMonteCarloConfidence(mockPaths, 2000000);
    expect(confidence).toBe(0);
  });

  it('should return 50% when exactly half meet target', () => {
    const mockPaths = [
      { finalCorpus: 1000000, monthlyValues: [] },
      { finalCorpus: 2000000, monthlyValues: [] },
      { finalCorpus: 1000000, monthlyValues: [] },
      { finalCorpus: 2000000, monthlyValues: [] },
    ];

    const confidence = calculateMonteCarloConfidence(mockPaths, 1500000);
    expect(confidence).toBe(50);
  });
});

describe('calculateRequiredSIPMonteCarlo', () => {
  const allocations: AssetAllocation[] = [
    { assetClass: 'largeCap', percentage: 100 },
  ];

  const assetClassDataMap = {
    largeCap: fullAssetClasses.largeCap['10Y']!,
  };

  const initialCorpusByAssetClass = {
    largeCap: 1000000,
  };

  it('should calculate required SIP using binary search', () => {
    const requiredSIP = calculateRequiredSIPMonteCarlo(
      5000000,
      initialCorpusByAssetClass,
      allocations,
      assetClassDataMap,
      10,
      100 // Use fewer paths for faster test
    );

    expect(requiredSIP).toBeGreaterThan(0);
    expect(requiredSIP % 1000).toBe(0); // Should be rounded to nearest 1000
  });

  it('should return 0 if target already met', () => {
    // Use a very high corpus that will definitely meet the target even in worst case
    const highInitialCorpus = { largeCap: 20000000 }; // 20M for 5M target
    const requiredSIP = calculateRequiredSIPMonteCarlo(
      5000000,
      highInitialCorpus,
      allocations,
      assetClassDataMap,
      10,
      100
    );

    expect(requiredSIP).toBe(0);
  });

  it('should throw error if volatilityPct missing', () => {
    const dataWithoutVolatility = {
      ...fullAssetClasses.largeCap['10Y']!,
    };
    delete (dataWithoutVolatility as any).volatilityPct;

    const assetClassDataMapInvalid = {
      largeCap: dataWithoutVolatility,
    };

    expect(() => {
      calculateRequiredSIPMonteCarlo(
        5000000,
        initialCorpusByAssetClass,
        allocations,
        assetClassDataMapInvalid,
        10,
        10
      );
    }).toThrow('volatilityPct is required');
  });

  it('should round to nearest 1000', () => {
    const requiredSIP = calculateRequiredSIPMonteCarlo(
      5000000,
      initialCorpusByAssetClass,
      allocations,
      assetClassDataMap,
      10,
      100
    );

    expect(requiredSIP % 1000).toBe(0);
  });
});

describe('calculateMinimumSIPForConfidenceMonteCarlo', () => {
  const allocations: AssetAllocation[] = [
    { assetClass: 'largeCap', percentage: 100 },
  ];

  const assetClassDataMap = {
    largeCap: fullAssetClasses.largeCap['10Y']!,
  };

  const initialCorpusByAssetClass = {
    largeCap: 1000000,
  };

  it('should return 0 when corpus alone yields >= 90% confidence', () => {
    const highInitialCorpus = { largeCap: 5000000 };
    const minSIP = calculateMinimumSIPForConfidenceMonteCarlo(
      5000000,
      highInitialCorpus,
      allocations,
      assetClassDataMap,
      10,
      100,
      90,
      50,
      0
    );
    expect(minSIP).toBe(0);
  });

  it('should return minimum SIP that achieves 90% confidence', () => {
    const minSIP = calculateMinimumSIPForConfidenceMonteCarlo(
      5000000,
      initialCorpusByAssetClass,
      allocations,
      assetClassDataMap,
      10,
      100,
      90,
      50,
      0
    );
    expect(minSIP).toBeGreaterThan(0);
    expect(minSIP % 1000).toBe(0);
    // Verify that minSIP achieves at least 90% confidence
    const monthlySIPByAssetClass = { largeCap: minSIP };
    const paths = runPortfolioMonteCarloSimulationLognormal(
      initialCorpusByAssetClass,
      monthlySIPByAssetClass,
      allocations,
      assetClassDataMap,
      10,
      500,
      0
    );
    const confidence = calculateMonteCarloConfidence(paths, 5000000);
    expect(confidence).toBeGreaterThanOrEqual(88); // Allow small Monte Carlo variance
  });
});

describe('validateEnvelope', () => {
  const allocations: AssetAllocation[] = [
    { assetClass: 'largeCap', percentage: 100 },
  ];

  const assetClassDataMap = {
    largeCap: fullAssetClasses.largeCap['10Y']!,
  };

  const envelopeBounds: EnvelopeBounds = {
    lower: 2000000,
    mean: 3000000,
  };

  it('should validate envelope bounds', () => {
    const validation = validateEnvelope(
      1000000,
      50000,
      allocations,
      assetClassDataMap,
      10,
      envelopeBounds
    );

    expect(validation.containmentPercent).toBeGreaterThanOrEqual(0);
    expect(validation.containmentPercent).toBeLessThanOrEqual(100);
    expect(validation.lowerTailAligned).toBeDefined();
    expect(validation.meanAligned).toBeDefined();
    expect(validation.isValid).toBeDefined();
    expect(validation.paths.length).toBeGreaterThan(0);
  });
});
