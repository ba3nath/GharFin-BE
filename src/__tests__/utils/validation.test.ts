import {
  AssetClassDataSchema,
  CustomerProfileSchema,
  GoalSchema,
  PlanningRequestSchema,
  normalizePlanningRequest,
  SIPInputSchema,
} from '../../utils/validation';
import { minimalAssetClass } from '../fixtures/assetClasses';
import { minimalCustomerProfile } from '../fixtures/customerProfiles';
import { moderateCustomerProfileInput } from '../fixtures/customerProfileInputs';
import { singleGoal } from '../fixtures/goals';
import { minimalSIPInput } from '../fixtures/sipInputs';
import { multipleGoals } from '../fixtures/goals';
import { minimalAssetsConfig } from '../fixtures/assetsConfig';

describe('AssetClassDataSchema', () => {
  it('should validate valid asset class data', () => {
    const result = AssetClassDataSchema.safeParse(minimalAssetClass);
    expect(result.success).toBe(true);
  });

  it('should validate asset class with volatilityPct', () => {
    const data = { ...minimalAssetClass, volatilityPct: 18.0 };
    const result = AssetClassDataSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('should reject missing required fields', () => {
    const invalid = { avgReturnPct: 10.0 };
    const result = AssetClassDataSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject invalid probNegativeYearPct (>100)', () => {
    const invalid = { ...minimalAssetClass, probNegativeYearPct: 150 };
    const result = AssetClassDataSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject invalid probNegativeYearPct (<0)', () => {
    const invalid = { ...minimalAssetClass, probNegativeYearPct: -10 };
    const result = AssetClassDataSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject positive expectedShortfallPct', () => {
    const invalid = { ...minimalAssetClass, expectedShortfallPct: 15 };
    const result = AssetClassDataSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject positive maxDrawdownPct', () => {
    const invalid = { ...minimalAssetClass, maxDrawdownPct: 30 };
    const result = AssetClassDataSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should accept optional volatilityPct', () => {
    const result = AssetClassDataSchema.safeParse(minimalAssetClass);
    expect(result.success).toBe(true);
  });

  it('should reject negative volatilityPct', () => {
    const invalid = { ...minimalAssetClass, volatilityPct: -10 };
    const result = AssetClassDataSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe('CustomerProfileSchema', () => {
  it('should validate valid customer profile', () => {
    const result = CustomerProfileSchema.safeParse(minimalCustomerProfile);
    expect(result.success).toBe(true);
  });

  it('should reject negative totalNetWorth', () => {
    const invalid = { ...minimalCustomerProfile, totalNetWorth: -1000 };
    const result = CustomerProfileSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject missing required fields', () => {
    const invalid = { asOfDate: "2024-01-01" };
    const result = CustomerProfileSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject negative corpus amounts', () => {
    const invalid = {
      ...minimalCustomerProfile,
      corpus: {
        ...minimalCustomerProfile.corpus,
        byAssetClass: { largeCap: -1000 },
      },
    };
    const result = CustomerProfileSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe('GoalSchema', () => {
  it('should validate valid goal with tier-level priorities', () => {
    const result = GoalSchema.safeParse(singleGoal);
    expect(result.success).toBe(true);
  });

  it('should reject goal with missing tier priority', () => {
    const invalid = {
      ...singleGoal,
      tiers: {
        basic: { targetAmount: [4500000, 5000000] },
        ambitious: { targetAmount: [7500000, 8000000], priority: 2 }
      }
    };
    const result = GoalSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject tier with invalid priority (non-integer)', () => {
    const invalid = {
      ...singleGoal,
      tiers: {
        basic: { targetAmount: [4500000, 5000000], priority: 1.5 },
        ambitious: { targetAmount: [7500000, 8000000], priority: 2 }
      }
    };
    const result = GoalSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject tier with invalid priority (<1)', () => {
    const invalid = {
      ...singleGoal,
      tiers: {
        basic: { targetAmount: [4500000, 5000000], priority: 0 },
        ambitious: { targetAmount: [7500000, 8000000], priority: 2 }
      }
    };
    const result = GoalSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject negative horizonYears', () => {
    const invalid = { ...singleGoal, horizonYears: -5 };
    const result = GoalSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject targetAmount range with max <= min', () => {
    const invalid = {
      ...singleGoal,
      tiers: {
        basic: { targetAmount: [5000000, 5000000], priority: 1 },
        ambitious: { targetAmount: [7500000, 8000000], priority: 2 }
      }
    };
    const result = GoalSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject missing tiers', () => {
    const invalid = { ...singleGoal };
    delete (invalid as any).tiers;
    const result = GoalSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe('SIPInputSchema', () => {
  it('should validate valid SIP input', () => {
    const result = SIPInputSchema.safeParse(minimalSIPInput);
    expect(result.success).toBe(true);
  });

  it('should reject negative monthlySIP', () => {
    const invalid = { ...minimalSIPInput, monthlySIP: -1000 };
    const result = SIPInputSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject invalid stretchSIPPercent (>100)', () => {
    const invalid = { ...minimalSIPInput, stretchSIPPercent: 150 };
    const result = SIPInputSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject negative annualStepUpPercent', () => {
    const invalid = { ...minimalSIPInput, annualStepUpPercent: -10 };
    const result = SIPInputSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe('PlanningRequestSchema', () => {
  const validRequest = {
    assets: minimalAssetsConfig,
    customer_profile: moderateCustomerProfileInput,
    goals: { goals: multipleGoals },
    monthlySIP: 5000,
  };

  it('validates request with assets and customer_profile', () => {
    const result = PlanningRequestSchema.safeParse(validRequest);
    expect(result.success).toBe(true);
  });

  it('rejects when assets is missing', () => {
    const result = PlanningRequestSchema.safeParse({
      ...validRequest,
      assets: undefined,
    });
    expect(result.success).toBe(false);
  });

  it('rejects when customer_profile is missing', () => {
    const result = PlanningRequestSchema.safeParse({
      ...validRequest,
      customer_profile: undefined,
    });
    expect(result.success).toBe(false);
  });

  it('rejects when customer_profile existing_asset_allocation does not sum to 100', () => {
    const result = PlanningRequestSchema.safeParse({
      ...validRequest,
      customer_profile: {
        ...moderateCustomerProfileInput,
        stability: {
          ...moderateCustomerProfileInput.stability,
          existing_asset_allocation: { equity: 40, debt: 30, gold: 10, real_estate: 5 },
        },
      },
    });
    expect(result.success).toBe(false);
  });
});

describe('normalizePlanningRequest', () => {
  const validRequest = {
    assets: minimalAssetsConfig,
    customer_profile: moderateCustomerProfileInput,
    goals: { goals: multipleGoals },
    monthlySIP: 5000,
  };

  it('accepts request and returns normalized assetClasses and customerProfile', () => {
    const result = normalizePlanningRequest(validRequest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.assetClasses).toBeDefined();
      expect(Object.keys(result.data.assetClasses)).toEqual([
        'Large Cap Fund',
        'Short Duration Debt Fund',
        'Gold ETF / Gold Fund',
      ]);
      expect(result.data.bucketToCategories.equity).toContain('Large Cap Fund');
      expect(result.data.benchmark).toEqual({ name: 'Nifty 50', beta_reference: 1.0 });
      expect(result.data.customerProfile.totalNetWorth).toBe(
        moderateCustomerProfileInput.financials.current_networth
      );
      expect(result.data.customerProfile.corpus.allowedAssetClasses.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('rejects invalid request', () => {
    const result = normalizePlanningRequest({ ...validRequest, monthlySIP: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects when customer_profile has invalid financials', () => {
    const result = normalizePlanningRequest({
      ...validRequest,
      customer_profile: {
        ...moderateCustomerProfileInput,
        financials: { ...moderateCustomerProfileInput.financials, current_networth: -1 },
      },
    });
    expect(result.success).toBe(false);
  });
});
