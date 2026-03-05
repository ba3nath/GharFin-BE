/**
 * Assets configuration: benchmark + mutual fund categories.
 * Used as an alternative input to legacy assetClasses; normalized to AssetClasses via assetsConfigToAssetClasses.
 */

import { z } from "zod";
import type { AssetClasses, AssetClassData } from "./AssetClass";

// ---------- Types ----------

export interface MinMaxRange {
  min: number;
  max: number;
}

export interface Benchmark {
  name: string;
  beta_reference: number;
}

export type AssetBucket = "equity" | "debt" | "gold";

/**
 * Profile type for picking from return/volatility ranges.
 * - conservative: lower end of return (CAGR), higher end of volatility (cautious)
 * - aggressive: higher end of return, lower end of volatility (optimistic)
 * - realistic: midpoint of return and volatility
 * Default when not set is conservative.
 */
export type ProfileType = "conservative" | "realistic" | "aggressive";

export interface MutualFundCategory {
  category: string;
  expected_return_cagr_range: MinMaxRange;
  beta_range: MinMaxRange;
  volatility_range: MinMaxRange;
  max_positive_year: number;
  max_negative_year: number;
  probability_negative_year: number;
  bucket?: AssetBucket;
}

export interface AssetsConfig {
  benchmark: Benchmark;
  mutual_fund_categories: MutualFundCategory[];
}

// ---------- Zod schemas ----------

const MinMaxRangeSchema = z
  .object({
    min: z.number(),
    max: z.number(),
  })
  .refine((r) => r.min <= r.max, { message: "min must be <= max" });

export const BenchmarkSchema = z.object({
  name: z.string(),
  beta_reference: z.number(),
});

export const MutualFundCategorySchema = z.object({
  category: z.string(),
  expected_return_cagr_range: MinMaxRangeSchema,
  beta_range: MinMaxRangeSchema,
  volatility_range: MinMaxRangeSchema,
  max_positive_year: z.number(),
  max_negative_year: z.number(),
  probability_negative_year: z.number().min(0).max(1),
  bucket: z.enum(["equity", "debt", "gold"]).optional(),
});

export const AssetsConfigSchema = z.object({
  benchmark: BenchmarkSchema,
  mutual_fund_categories: z.array(MutualFundCategorySchema).min(1),
});

export type AssetsConfigParsed = z.infer<typeof AssetsConfigSchema>;

// ---------- Adapter: AssetsConfig → AssetClasses ----------

function midpoint(range: MinMaxRange): number {
  return (range.min + range.max) / 2;
}

/**
 * Pick return (CAGR) and volatility from ranges by profile type.
 * - conservative: lower return, higher volatility (cautious assumptions)
 * - aggressive: higher return, lower volatility (optimistic)
 * - realistic: midpoint for both
 */
function pickByProfile(
  returnRange: MinMaxRange,
  volRange: MinMaxRange,
  profileType: ProfileType
): { returnPct: number; volatilityPct: number } {
  switch (profileType) {
    case "conservative":
      return {
        returnPct: returnRange.min * 100,
        volatilityPct: volRange.max * 100,
      };
    case "aggressive":
      return {
        returnPct: returnRange.max * 100,
        volatilityPct: volRange.min * 100,
      };
    case "realistic":
    default:
      return {
        returnPct: midpoint(returnRange) * 100,
        volatilityPct: midpoint(volRange) * 100,
      };
  }
}

/**
 * Convert AssetsConfig to the internal AssetClasses shape.
 * Each category becomes a key; same AssetClassData is used for 3Y, 5Y, 10Y (no horizon in new model).
 * profileType controls which end of return/volatility ranges is used (default conservative).
 */
export function assetsConfigToAssetClasses(
  config: AssetsConfig,
  profileType: ProfileType = "conservative"
): AssetClasses {
  const result: AssetClasses = {};

  for (const cat of config.mutual_fund_categories) {
    const { returnPct: avgReturnPct, volatilityPct } = pickByProfile(
      cat.expected_return_cagr_range,
      cat.volatility_range,
      profileType
    );
    const probNegativeYearPct = cat.probability_negative_year * 100;
    const expectedShortfallPct = cat.max_negative_year * 100; // already negative
    const maxDrawdownPct = cat.max_negative_year * 100;

    const data: AssetClassData = {
      avgReturnPct,
      probNegativeYearPct,
      expectedShortfallPct,
      maxDrawdownPct,
      volatilityPct,
    };

    result[cat.category] = data;
  }

  return result;
}

/**
 * Build AssetClasses for all three profile types (for per-goal use).
 */
export function buildAssetClassesByProfile(config: AssetsConfig): Record<ProfileType, AssetClasses> {
  return {
    conservative: assetsConfigToAssetClasses(config, "conservative"),
    realistic: assetsConfigToAssetClasses(config, "realistic"),
    aggressive: assetsConfigToAssetClasses(config, "aggressive"),
  };
}

/**
 * Bucket → category names for corpus derivation when using new assets format.
 * Only includes categories that have bucket set.
 */
export function getBucketToCategories(config: AssetsConfig): Record<AssetBucket, string[]> {
  const map: Record<AssetBucket, string[]> = {
    equity: [],
    debt: [],
    gold: [],
  };

  for (const cat of config.mutual_fund_categories) {
    if (cat.bucket && map[cat.bucket]) {
      map[cat.bucket].push(cat.category);
    }
  }

  return map;
}
