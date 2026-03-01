/**
 * Customer profile input (v2): financials, stability, risk_tolerance, liquidity_preferences.
 * No allowed/excluded asset list; allowed asset classes are derived from risk_tolerance
 * (volatility and drawdown limits) against request assetClasses.
 */

import { z } from "zod";
import type { CustomerProfile } from "./CustomerProfile";
import type { AssetClasses } from "./AssetClass";
import { getAssetClassData } from "./AssetClass";
import type { AssetBucket, ProfileType } from "./AssetsConfig";

// ---------- Zod schemas ----------

export const CustomerProfileFinancialsSchema = z.object({
  current_networth: z.number().min(0),
  liquid_networth: z.number().min(0),
  monthly_income: z.number().min(0),
  monthly_expenses: z.number().min(0),
  monthly_surplus: z.number(),
  sip_capacity: z.number().min(0),
  emergency_fund_months: z.number().min(0),
});

export const ExistingAssetAllocationSchema = z.object({
  equity: z.number().min(0).max(100),
  debt: z.number().min(0).max(100),
  gold: z.number().min(0).max(100),
  real_estate: z.number().min(0).max(100),
}).refine(
  (data) => data.equity + data.debt + data.gold + data.real_estate === 100,
  { message: "existing_asset_allocation must sum to 100" }
);

export const CustomerProfileStabilitySchema = z.object({
  income_stability_score: z.number().min(0).max(5),
  job_type: z.enum(["salaried", "self_employed", "business", "retired", "other"]),
  dependents_count: z.number().int().min(0),
  existing_asset_allocation: ExistingAssetAllocationSchema,
  debt_obligations: z.number().min(0),
});

export const CustomerProfileRiskToleranceSchema = z.object({
  max_acceptable_drawdown_percent: z.number().min(0).max(100),
  max_acceptable_volatility_percent: z.number().min(0).max(100),
  negative_year_tolerance_probability: z.number().min(0).max(1),
  panic_threshold_drop_percent: z.number().min(0).max(100),
});

export const CustomerProfileLiquidityPreferencesSchema = z.object({
  minimum_liquid_allocation_percent: z.number().min(0).max(100),
  rebalancing_preference: z.enum(["conservative", "moderate", "aggressive"]),
});

export const ProfileTypeSchema = z.enum(["conservative", "realistic", "aggressive"]);

export const CustomerProfileInputSchema = z.object({
  financials: CustomerProfileFinancialsSchema,
  stability: CustomerProfileStabilitySchema,
  risk_tolerance: CustomerProfileRiskToleranceSchema,
  liquidity_preferences: CustomerProfileLiquidityPreferencesSchema,
  /** Return/volatility assumption: conservative (lower return, higher vol), realistic (mid), aggressive (higher return, lower vol). Default conservative. */
  profile_type: ProfileTypeSchema.optional(),
  asOfDate: z.string().optional(),
});

export type CustomerProfileFinancials = z.infer<typeof CustomerProfileFinancialsSchema>;
export type ExistingAssetAllocation = z.infer<typeof ExistingAssetAllocationSchema>;
export type CustomerProfileStability = z.infer<typeof CustomerProfileStabilitySchema>;
export type CustomerProfileRiskTolerance = z.infer<typeof CustomerProfileRiskToleranceSchema>;
export type CustomerProfileLiquidityPreferences = z.infer<typeof CustomerProfileLiquidityPreferencesSchema>;
export type CustomerProfileInput = z.infer<typeof CustomerProfileInputSchema>;

// ---------- Bucket → asset class mapping (for corpus derivation) ----------

type TimeHorizon = "3Y" | "5Y" | "10Y";

/**
 * Derive allowed asset classes from customer risk_tolerance and asset class risk metrics.
 * Uses the given time horizon (default 10Y) for volatility and drawdown.
 * If no asset class passes the filter, returns the safest available (lowest volatility, smallest drawdown).
 */
export function deriveAllowedAssetClasses(
  assetClasses: AssetClasses,
  riskTolerance: CustomerProfileRiskTolerance,
  timeHorizon: TimeHorizon = "10Y"
): string[] {
  const { max_acceptable_volatility_percent, max_acceptable_drawdown_percent } = riskTolerance;
  const candidates: { name: string; volatility: number; drawdown: number }[] = [];

  for (const name of Object.keys(assetClasses)) {
    const data = getAssetClassData(assetClasses, name, timeHorizon);
    if (!data) continue;
    const volatility = data.volatilityPct ?? 0;
    const drawdown = Math.abs(data.maxDrawdownPct ?? 0);
    candidates.push({ name, volatility, drawdown });
  }

  const allowed = candidates.filter(
    (c) =>
      c.volatility <= max_acceptable_volatility_percent &&
      c.drawdown <= max_acceptable_drawdown_percent
  );

  if (allowed.length > 0) {
    return allowed.map((c) => c.name);
  }

  // Fallback: include safest (lowest volatility, then smallest drawdown)
  const sorted = [...candidates].sort(
    (a, b) => a.volatility - b.volatility || a.drawdown - b.drawdown
  );
  return sorted.slice(0, Math.max(1, sorted.length)).map((c) => c.name);
}

/**
 * Map bucket name to asset class names that belong to that bucket.
 * Only returns names that exist in availableAssetClasses.
 */
function getAssetClassesForBucket(
  bucket: "equity" | "debt" | "gold" | "real_estate",
  availableAssetClasses: string[],
  bucketToCategories: Record<AssetBucket, string[]>
): string[] {
  if (bucket === "real_estate") return [];
  const set = new Set(availableAssetClasses);
  const names = bucketToCategories[bucket] ?? [];
  return names.filter((n) => set.has(n));
}

/**
 * Map customer_profile + assetClasses to internal CustomerProfile.
 * - totalNetWorth from financials.current_networth
 * - asOfDate from input or default
 * - allowedAssetClasses derived from risk_tolerance vs assetClasses
 * - byAssetClass from existing_asset_allocation via bucketToCategories
 */
export function mapCustomerProfileInputToInternal(
  input: CustomerProfileInput,
  assetClasses: AssetClasses,
  options: {
    bucketToCategories: Record<AssetBucket, string[]>;
    asOfDateDefault?: string;
    timeHorizon?: TimeHorizon;
  }
): CustomerProfile {
  const asOfDate = input.asOfDate ?? options.asOfDateDefault ?? "2026-01-01";
  const timeHorizon = options.timeHorizon ?? "10Y";

  const allowedAssetClasses = deriveAllowedAssetClasses(
    assetClasses,
    input.risk_tolerance,
    timeHorizon
  );

  const netWorth = input.financials.current_networth;
  const alloc = input.stability.existing_asset_allocation;

  const byAssetClass: Record<string, number> = {};

  const buckets: ("equity" | "debt" | "gold" | "real_estate")[] = [
    "equity",
    "debt",
    "gold",
    "real_estate",
  ];
  const bucketPct: Record<string, number> = {
    equity: alloc.equity / 100,
    debt: alloc.debt / 100,
    gold: alloc.gold / 100,
    real_estate: alloc.real_estate / 100,
  };

  for (const bucket of buckets) {
    const amount = netWorth * bucketPct[bucket];
    const classes = getAssetClassesForBucket(
      bucket,
      allowedAssetClasses,
      options.bucketToCategories
    );
    if (classes.length === 0) {
      // No allowed class in this bucket: assign to first allowed class overall
      if (allowedAssetClasses.length > 0) {
        const fallback = allowedAssetClasses[0];
        byAssetClass[fallback] = (byAssetClass[fallback] ?? 0) + amount;
      }
    } else {
      const perClass = amount / classes.length;
      for (const ac of classes) {
        byAssetClass[ac] = (byAssetClass[ac] ?? 0) + perClass;
      }
    }
  }

  return {
    asOfDate,
    totalNetWorth: netWorth,
    corpus: {
      byAssetClass,
      allowedAssetClasses,
    },
  };
}
