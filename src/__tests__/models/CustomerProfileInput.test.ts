import type { AssetBucket } from "../../models/AssetsConfig";
import {
  deriveAllowedAssetClasses,
  mapCustomerProfileInputToInternal,
  CustomerProfileInputSchema,
} from "../../models/CustomerProfileInput";
import { getTotalCorpus } from "../../models/CustomerProfile";
import {
  assetsConfigToAssetClasses,
  getBucketToCategories,
} from "../../models/AssetsConfig";
import {
  conservativeCustomerProfileInput,
  moderateCustomerProfileInput,
  strictRiskCustomerProfileInput,
} from "../fixtures/customerProfileInputs";
import { fullAssetClasses } from "../fixtures/assetClasses";
import { minimalAssetsConfig } from "../fixtures/assetsConfig";

/** Bucket mapping for legacy fullAssetClasses keys (used only in tests). */
const legacyBucketToCategories: Record<AssetBucket, string[]> = {
  equity: ["largeCap", "midCap", "smallCap", "flexiCap", "microCap"],
  debt: ["bond", "cash"],
  gold: ["gold"],
};

describe("CustomerProfileInput", () => {
  describe("deriveAllowedAssetClasses", () => {
    it("returns only asset classes within volatility and drawdown limits (10Y)", () => {
      // fullAssetClasses 10Y: largeCap vol 15 drawdown 28, bond vol 5 drawdown 0, midCap vol 20 drawdown 38
      const riskTolerance = {
        max_acceptable_volatility_percent: 18,
        max_acceptable_drawdown_percent: 30,
        negative_year_tolerance_probability: 0.2,
        panic_threshold_drop_percent: 25,
      };
      const allowed = deriveAllowedAssetClasses(fullAssetClasses, riskTolerance, "10Y");
      expect(allowed).toContain("bond");
      expect(allowed).toContain("largeCap");
      expect(allowed).not.toContain("midCap"); // vol 20 > 18
    });

    it("returns at least one (safest) when no asset passes", () => {
      const riskTolerance = {
        max_acceptable_volatility_percent: 1,
        max_acceptable_drawdown_percent: 1,
        negative_year_tolerance_probability: 0.01,
        panic_threshold_drop_percent: 1,
      };
      const allowed = deriveAllowedAssetClasses(fullAssetClasses, riskTolerance, "10Y");
      expect(allowed.length).toBeGreaterThanOrEqual(1);
      expect(allowed[0]).toBe("bond"); // lowest volatility
    });

    it("includes all when limits are high", () => {
      const riskTolerance = {
        max_acceptable_volatility_percent: 30,
        max_acceptable_drawdown_percent: 50,
        negative_year_tolerance_probability: 0.4,
        panic_threshold_drop_percent: 40,
      };
      const allowed = deriveAllowedAssetClasses(fullAssetClasses, riskTolerance, "10Y");
      expect(allowed).toContain("largeCap");
      expect(allowed).toContain("bond");
      expect(allowed).toContain("midCap");
    });
  });

  describe("mapCustomerProfileInputToInternal", () => {
    it("maps financials.current_networth to totalNetWorth", () => {
      const profile = mapCustomerProfileInputToInternal(
        moderateCustomerProfileInput,
        fullAssetClasses,
        { bucketToCategories: legacyBucketToCategories }
      );
      expect(profile.totalNetWorth).toBe(25_000_000);
    });

    it("uses asOfDate from input when provided", () => {
      const profile = mapCustomerProfileInputToInternal(
        { ...moderateCustomerProfileInput, asOfDate: "2025-03-01" },
        fullAssetClasses,
        { bucketToCategories: legacyBucketToCategories }
      );
      expect(profile.asOfDate).toBe("2025-03-01");
    });

    it("uses default asOfDate when not provided", () => {
      const input = { ...moderateCustomerProfileInput, asOfDate: undefined };
      const profile = mapCustomerProfileInputToInternal(input, fullAssetClasses, {
        bucketToCategories: legacyBucketToCategories,
        asOfDateDefault: "2024-01-01",
      });
      expect(profile.asOfDate).toBe("2024-01-01");
    });

    it("derives allowedAssetClasses from risk_tolerance", () => {
      const profile = mapCustomerProfileInputToInternal(
        moderateCustomerProfileInput,
        fullAssetClasses,
        { bucketToCategories: legacyBucketToCategories }
      );
      expect(profile.corpus.allowedAssetClasses.length).toBeGreaterThanOrEqual(1);
      expect(profile.corpus.allowedAssetClasses).toContain("bond");
    });

    it("distributes corpus by existing_asset_allocation across allowed classes only", () => {
      const profile = mapCustomerProfileInputToInternal(
        moderateCustomerProfileInput,
        fullAssetClasses,
        { bucketToCategories: legacyBucketToCategories }
      );
      const total = getTotalCorpus(profile);
      expect(total).toBe(25_000_000);
      const byAsset = profile.corpus.byAssetClass;
      for (const ac of profile.corpus.allowedAssetClasses) {
        expect(byAsset[ac]).toBeDefined();
        expect(byAsset[ac]).toBeGreaterThanOrEqual(0);
      }
    });

    it("conservative profile with only bond allowed yields corpus in bond", () => {
      const profile = mapCustomerProfileInputToInternal(
        conservativeCustomerProfileInput,
        fullAssetClasses,
        { bucketToCategories: legacyBucketToCategories }
      );
      expect(profile.corpus.allowedAssetClasses).toContain("bond");
      const total = getTotalCorpus(profile);
      expect(total).toBe(5_000_000);
    });

    it("strict risk profile still produces valid profile with fallback allowed set", () => {
      const profile = mapCustomerProfileInputToInternal(
        strictRiskCustomerProfileInput,
        fullAssetClasses,
        { bucketToCategories: legacyBucketToCategories }
      );
      expect(profile.corpus.allowedAssetClasses.length).toBeGreaterThanOrEqual(1);
      expect(profile.totalNetWorth).toBe(1_000_000);
    });

    it("with bucketToCategories uses category names in allowedAssetClasses and byAssetClass", () => {
      const assetClasses = assetsConfigToAssetClasses(minimalAssetsConfig, "conservative");
      const bucketToCategories = getBucketToCategories(minimalAssetsConfig);
      const profile = mapCustomerProfileInputToInternal(
        moderateCustomerProfileInput,
        assetClasses,
        { bucketToCategories }
      );
      const categoryNames = minimalAssetsConfig.mutual_fund_categories.map((c) => c.category);
      expect(profile.corpus.allowedAssetClasses.length).toBeGreaterThanOrEqual(1);
      for (const name of profile.corpus.allowedAssetClasses) {
        expect(categoryNames).toContain(name);
      }
      const total = getTotalCorpus(profile);
      expect(total).toBe(25_000_000);
      for (const key of Object.keys(profile.corpus.byAssetClass)) {
        expect(categoryNames).toContain(key);
      }
      expect(profile.corpus.byAssetClass["Short Duration Debt Fund"]).toBeDefined();
    });
  });

  describe("CustomerProfileInputSchema", () => {
    it("accepts valid customer_profile", () => {
      const result = CustomerProfileInputSchema.safeParse(moderateCustomerProfileInput);
      expect(result.success).toBe(true);
    });

    it("rejects when existing_asset_allocation does not sum to 100", () => {
      const invalid = {
        ...moderateCustomerProfileInput,
        stability: {
          ...moderateCustomerProfileInput.stability,
          existing_asset_allocation: { equity: 50, debt: 30, gold: 10, real_estate: 5 },
        },
      };
      const result = CustomerProfileInputSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("rejects invalid job_type", () => {
      const invalid = {
        ...moderateCustomerProfileInput,
        stability: { ...moderateCustomerProfileInput.stability, job_type: "invalid" },
      };
      const result = CustomerProfileInputSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });
});
