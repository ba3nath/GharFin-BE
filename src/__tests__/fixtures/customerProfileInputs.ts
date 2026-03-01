import type { CustomerProfileInput } from "../../models/CustomerProfileInput";

/**
 * Conservative risk: low volatility and drawdown limits.
 * With typical assetClasses (e.g. fullAssetClasses), only bond (and possibly gold) will be allowed.
 */
export const conservativeCustomerProfileInput: CustomerProfileInput = {
  financials: {
    current_networth: 5_000_000,
    liquid_networth: 1_500_000,
    monthly_income: 150_000,
    monthly_expenses: 90_000,
    monthly_surplus: 60_000,
    sip_capacity: 40_000,
    emergency_fund_months: 6,
  },
  stability: {
    income_stability_score: 4,
    job_type: "salaried",
    dependents_count: 2,
    existing_asset_allocation: {
      equity: 40,
      debt: 50,
      gold: 10,
      real_estate: 0,
    },
    debt_obligations: 500_000,
  },
  risk_tolerance: {
    max_acceptable_drawdown_percent: 15,
    max_acceptable_volatility_percent: 10,
    negative_year_tolerance_probability: 0.15,
    panic_threshold_drop_percent: 12,
  },
  liquidity_preferences: {
    minimum_liquid_allocation_percent: 20,
    rebalancing_preference: "conservative",
  },
  asOfDate: "2026-01-01",
};

/**
 * Moderate risk: allows largeCap, bond, gold with typical assetClasses (10Y: vol ≤22, drawdown ≤30).
 */
export const moderateCustomerProfileInput: CustomerProfileInput = {
  financials: {
    current_networth: 25_000_000,
    liquid_networth: 8_000_000,
    monthly_income: 300_000,
    monthly_expenses: 150_000,
    monthly_surplus: 150_000,
    sip_capacity: 100_000,
    emergency_fund_months: 9,
  },
  stability: {
    income_stability_score: 4,
    job_type: "salaried",
    dependents_count: 2,
    existing_asset_allocation: {
      equity: 50,
      debt: 30,
      gold: 10,
      real_estate: 10,
    },
    debt_obligations: 2_000_000,
  },
  risk_tolerance: {
    max_acceptable_drawdown_percent: 30,
    max_acceptable_volatility_percent: 22,
    negative_year_tolerance_probability: 0.3,
    panic_threshold_drop_percent: 25,
  },
  liquidity_preferences: {
    minimum_liquid_allocation_percent: 15,
    rebalancing_preference: "moderate",
  },
  asOfDate: "2026-01-01",
};

/**
 * Very strict risk: no asset class may pass (vol 2%, drawdown 2%).
 * Mapper should fall back to safest asset(s).
 */
export const strictRiskCustomerProfileInput: CustomerProfileInput = {
  financials: {
    current_networth: 1_000_000,
    liquid_networth: 500_000,
    monthly_income: 80_000,
    monthly_expenses: 50_000,
    monthly_surplus: 30_000,
    sip_capacity: 20_000,
    emergency_fund_months: 6,
  },
  stability: {
    income_stability_score: 3,
    job_type: "salaried",
    dependents_count: 1,
    existing_asset_allocation: {
      equity: 20,
      debt: 70,
      gold: 10,
      real_estate: 0,
    },
    debt_obligations: 200_000,
  },
  risk_tolerance: {
    max_acceptable_drawdown_percent: 2,
    max_acceptable_volatility_percent: 2,
    negative_year_tolerance_probability: 0.05,
    panic_threshold_drop_percent: 2,
  },
  liquidity_preferences: {
    minimum_liquid_allocation_percent: 30,
    rebalancing_preference: "conservative",
  },
  asOfDate: "2024-06-01",
};
