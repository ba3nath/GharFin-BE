import {
  AssetsConfigSchema,
  assetsConfigToAssetClasses,
  buildAssetClassesByProfile,
  getBucketToCategories,
} from "../../models/AssetsConfig";
import { getAssetClassData } from "../../models/AssetClass";
import { minimalAssetsConfig, fullAssetsConfig } from "../fixtures/assetsConfig";

describe("AssetsConfigSchema", () => {
  it("accepts valid minimal config", () => {
    const result = AssetsConfigSchema.safeParse(minimalAssetsConfig);
    expect(result.success).toBe(true);
  });

  it("accepts valid full config", () => {
    const result = AssetsConfigSchema.safeParse(fullAssetsConfig);
    expect(result.success).toBe(true);
  });

  it("rejects missing benchmark", () => {
    const { benchmark: _, ...withoutBenchmark } = minimalAssetsConfig;
    const result = AssetsConfigSchema.safeParse(withoutBenchmark);
    expect(result.success).toBe(false);
  });

  it("rejects empty mutual_fund_categories", () => {
    const result = AssetsConfigSchema.safeParse({
      ...minimalAssetsConfig,
      mutual_fund_categories: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects range with min > max", () => {
    const bad = {
      ...minimalAssetsConfig,
      mutual_fund_categories: [
        {
          ...minimalAssetsConfig.mutual_fund_categories[0],
          expected_return_cagr_range: { min: 0.2, max: 0.1 },
        },
      ],
    };
    const result = AssetsConfigSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects probability_negative_year > 1", () => {
    const bad = {
      ...minimalAssetsConfig,
      mutual_fund_categories: [
        {
          ...minimalAssetsConfig.mutual_fund_categories[0],
          probability_negative_year: 1.5,
        },
      ],
    };
    const result = AssetsConfigSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});

describe("assetsConfigToAssetClasses", () => {
  it("produces one key per category", () => {
    const out = assetsConfigToAssetClasses(minimalAssetsConfig);
    expect(Object.keys(out)).toEqual([
      "Large Cap Fund",
      "Short Duration Debt Fund",
      "Gold ETF / Gold Fund",
    ]);
  });

  it("populates single AssetClassData per category (same CAGR for all horizons)", () => {
    const out = assetsConfigToAssetClasses(minimalAssetsConfig);
    const key = "Large Cap Fund";
    expect(out[key]).toBeDefined();
    expect(out[key]).toHaveProperty("avgReturnPct");
    expect(out[key]).toHaveProperty("volatilityPct");
  });

  it("conservative uses lower return and higher volatility (default)", () => {
    const out = assetsConfigToAssetClasses(minimalAssetsConfig, "conservative");
    const data = out["Large Cap Fund"]!;
    expect(data.avgReturnPct).toBeCloseTo(13, 1); // min of range
    expect(data.volatilityPct).toBeCloseTo(21, 1); // max of range
    expect(data.probNegativeYearPct).toBeCloseTo(23, 1);
    expect(data.expectedShortfallPct).toBeCloseTo(-48, 1);
  });

  it("realistic uses midpoint of return and volatility", () => {
    const out = assetsConfigToAssetClasses(minimalAssetsConfig, "realistic");
    const data = out["Large Cap Fund"]!;
    expect(data.avgReturnPct).toBeCloseTo(14, 1);
    expect(data.volatilityPct).toBeCloseTo(19, 1);
  });

  it("aggressive uses higher return and lower volatility", () => {
    const out = assetsConfigToAssetClasses(minimalAssetsConfig, "aggressive");
    const data = out["Large Cap Fund"]!;
    expect(data.avgReturnPct).toBeCloseTo(15, 1); // max of range
    expect(data.volatilityPct).toBeCloseTo(17, 1); // min of range
  });

  it("getAssetClassData returns data for converted config", () => {
    const assetClasses = assetsConfigToAssetClasses(minimalAssetsConfig, "realistic");
    const data = getAssetClassData(assetClasses, "Large Cap Fund");
    expect(data).not.toBeNull();
    expect(data!.avgReturnPct).toBeCloseTo(14, 1);
  });
});

describe("getBucketToCategories", () => {
  it("returns category names grouped by bucket", () => {
    const map = getBucketToCategories(minimalAssetsConfig);
    expect(map.equity).toContain("Large Cap Fund");
    expect(map.debt).toContain("Short Duration Debt Fund");
    expect(map.gold).toContain("Gold ETF / Gold Fund");
  });

  it("returns empty arrays for buckets with no categories when using config without bucket on some", () => {
    const configNoBucket = {
      ...minimalAssetsConfig,
      mutual_fund_categories: minimalAssetsConfig.mutual_fund_categories.map(
        ({ bucket: _, ...rest }) => rest
      ),
    };
    const map = getBucketToCategories(configNoBucket);
    expect(map.equity).toEqual([]);
    expect(map.debt).toEqual([]);
    expect(map.gold).toEqual([]);
  });

  it("full config has multiple categories per bucket", () => {
    const map = getBucketToCategories(fullAssetsConfig);
    expect(map.equity.length).toBeGreaterThanOrEqual(2);
    expect(map.debt.length).toBeGreaterThanOrEqual(2);
    expect(map.gold).toContain("Gold ETF / Gold Fund");
  });
});

describe("buildAssetClassesByProfile", () => {
  it("returns conservative, realistic, aggressive with different return/vol", () => {
    const byProfile = buildAssetClassesByProfile(minimalAssetsConfig);
    const cons = byProfile.conservative["Large Cap Fund"]!;
    const real = byProfile.realistic["Large Cap Fund"]!;
    const agg = byProfile.aggressive["Large Cap Fund"]!;
    expect(cons.avgReturnPct).toBeLessThan(real.avgReturnPct);
    expect(real.avgReturnPct).toBeLessThan(agg.avgReturnPct);
    expect(cons.volatilityPct ?? 0).toBeGreaterThan(real.volatilityPct ?? 0);
    expect(real.volatilityPct ?? 0).toBeGreaterThan(agg.volatilityPct ?? 0);
  });
});
