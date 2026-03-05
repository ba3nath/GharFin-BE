import { z } from "zod";
import {
  CustomerProfileInputSchema,
  mapCustomerProfileInputToInternal,
} from "../models/CustomerProfileInput";
import type { CustomerProfile } from "../models/CustomerProfile";
import type { AssetClasses } from "../models/AssetClass";
import {
  AssetsConfigSchema,
  assetsConfigToAssetClasses,
  buildAssetClassesByProfile,
  getBucketToCategories,
} from "../models/AssetsConfig";
import type { AssetBucket, ProfileType } from "../models/AssetsConfig";

/**
 * Zod validation schemas for input data validation.
 * These schemas ensure data integrity for financial planning calculations.
 */

/**
 * Schema for validating asset class data including return metrics and risk characteristics.
 * All percentage values are in percent (e.g., 10 means 10%).
 */
export const AssetClassDataSchema = z.object({
  avgReturnPct: z.number(),
  probNegativeYearPct: z.number().min(0).max(100),
  expectedShortfallPct: z.number().max(0), // Should be negative (CVaR)
  maxDrawdownPct: z.number().max(0), // Should be negative
  volatilityPct: z.number().min(0).optional(), // Required for Method 2 (Monte Carlo)
});

/**
 * Schema for validating the complete asset classes data structure.
 * Maps asset class names to single AssetClassData (same CAGR for all horizons).
 */
export const AssetClassesSchema = z.record(z.string(), AssetClassDataSchema);

/**
 * Schema for corpus allocation by asset class.
 * Maps asset class names to corpus amounts (must be non-negative).
 */
export const CorpusByAssetClassSchema = z.record(z.string(), z.number().min(0));

/**
 * Schema for customer profile including corpus and allowed asset classes.
 */
export const CustomerProfileSchema = z.object({
  asOfDate: z.string(),
  totalNetWorth: z.number().min(0),
  corpus: z.object({
    byAssetClass: CorpusByAssetClassSchema,
    allowedAssetClasses: z.array(z.string()),
  }),
});

/**
 * Schema for a single goal tier (basic or ambitious).
 * targetAmount is [min, max] with strict ordering (max > min).
 */
export const GoalTierSchema = z.object({
  targetAmount: z
    .tuple([z.number().min(0), z.number().min(0)])
    .refine(([min, max]) => max > min, {
      message: "targetAmount[1] must be greater than targetAmount[0]",
    }),
  priority: z.number().int().min(1),
});

/**
 * Profile type for return/volatility assumption (conservative = lower return/higher vol, etc.).
 * Default when omitted is conservative.
 */
export const ProfileTypeSchema = z.enum(["conservative", "realistic", "aggressive"]);

/**
 * Schema for a financial goal with horizon and tier targets.
 * Priority is now at the tier level, not at the goal level.
 * profile_type (optional) drives which end of asset return/volatility ranges is used for this goal; default conservative.
 */
export const GoalSchema = z.object({
  goalId: z.string(),
  goalName: z.string(),
  horizonYears: z.number().min(0),
  profile_type: ProfileTypeSchema.optional(),
  tiers: z.object({
    basic: GoalTierSchema,
    ambitious: GoalTierSchema,
  }),
});

/**
 * Schema for the goals collection.
 */
export const GoalsSchema = z.object({
  goals: z.array(GoalSchema),
});

/**
 * Schema for SIP (Systematic Investment Plan) input parameters.
 */
export const SIPInputSchema = z.object({
  monthlySIP: z.number().min(0),
  stretchSIPPercent: z.number().min(0).max(100),
  annualStepUpPercent: z.number().min(0),
});

/**
 * Schema for planning API request body (Method 1, 2, 3).
 * Requires assets (benchmark + mutual_fund_categories) and customer_profile.
 */
export const PlanningRequestSchema = z.object({
  assets: AssetsConfigSchema,
  customer_profile: CustomerProfileInputSchema,
  goals: GoalsSchema,
  monthlySIP: z.number().min(0),
  stretchSIPPercent: z.number().min(0).max(100).optional(),
  annualStepUpPercent: z.number().min(0).optional(),
  monteCarloPaths: z.number().int().min(1).optional(),
  maxIterations: z.number().int().min(1).optional(),
});

export type PlanningRequest = z.infer<typeof PlanningRequestSchema>;

/**
 * Normalized planning request: always has customerProfile (internal shape) and assetClasses (from assets).
 */
export interface NormalizedPlanningRequest {
  assetClasses: AssetClasses;
  customerProfile: CustomerProfile;
  goals: z.infer<typeof GoalsSchema>;
  monthlySIP: number;
  stretchSIPPercent?: number;
  annualStepUpPercent?: number;
  monteCarloPaths?: number;
  maxIterations?: number;
  bucketToCategories: Record<AssetBucket, string[]>;
  benchmark: { name: string; beta_reference: number };
  assetClassesByProfile: Record<ProfileType, AssetClasses>;
}

/**
 * Parse request body and return normalized request.
 * Requires assets and customer_profile.
 */
export function normalizePlanningRequest(body: unknown): {
  success: true;
  data: NormalizedPlanningRequest;
} | {
  success: false;
  error: z.ZodError;
} {
  const parsed = PlanningRequestSchema.safeParse(body);
  if (!parsed.success) {
    return { success: false, error: parsed.error };
  }
  const { assets, customer_profile } = parsed.data;
  const customerProfileType: ProfileType =
    (customer_profile.profile_type as ProfileType) ?? "conservative";
  const assetClasses = assetsConfigToAssetClasses(assets, customerProfileType);
  const bucketToCategories = getBucketToCategories(assets);
  const assetClassesByProfile = buildAssetClassesByProfile(assets);
  const customerProfile = mapCustomerProfileInputToInternal(
    customer_profile,
    assetClasses,
    { bucketToCategories }
  );
  return {
    success: true,
    data: {
      assetClasses,
      customerProfile,
      goals: parsed.data.goals,
      monthlySIP: parsed.data.monthlySIP,
      stretchSIPPercent: parsed.data.stretchSIPPercent,
      annualStepUpPercent: parsed.data.annualStepUpPercent,
      monteCarloPaths: parsed.data.monteCarloPaths,
      maxIterations: parsed.data.maxIterations,
      bucketToCategories,
      benchmark: assets.benchmark,
      assetClassesByProfile,
    },
  };
}
