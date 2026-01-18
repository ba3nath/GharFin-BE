import { z } from "zod";

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
 * Schema for time horizon-specific asset class data.
 * Supports 3Y, 5Y, and 10Y time horizons.
 */
export const TimeHorizonDataSchema = z.object({
  "3Y": AssetClassDataSchema.optional(),
  "5Y": AssetClassDataSchema.optional(),
  "10Y": AssetClassDataSchema.optional(),
});

/**
 * Schema for validating the complete asset classes data structure.
 * Maps asset class names to their time horizon-specific data.
 */
export const AssetClassesSchema = z.record(
  z.string(),
  TimeHorizonDataSchema
);

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
 */
export const GoalTierSchema = z.object({
  targetAmount: z.number().min(0),
});

/**
 * Schema for a financial goal with priority, horizon, and tier targets.
 */
export const GoalSchema = z.object({
  goalId: z.string(),
  goalName: z.string(),
  priority: z.number().int().min(1),
  horizonYears: z.number().min(0),
  amountVariancePct: z.number().min(0).max(100),
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
