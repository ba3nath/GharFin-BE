import {
  AssetClassDataSchema,
  CustomerProfileSchema,
  GoalSchema,
  SIPInputSchema,
} from '../../utils/validation';
import { minimalAssetClass } from '../fixtures/assetClasses';
import { minimalCustomerProfile } from '../fixtures/customerProfiles';
import { singleGoal } from '../fixtures/goals';
import { minimalSIPInput } from '../fixtures/sipInputs';

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
        basic: { targetAmount: 5000000 },
        ambitious: { targetAmount: 8000000, priority: 2 }
      }
    };
    const result = GoalSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject tier with invalid priority (non-integer)', () => {
    const invalid = {
      ...singleGoal,
      tiers: {
        basic: { targetAmount: 5000000, priority: 1.5 },
        ambitious: { targetAmount: 8000000, priority: 2 }
      }
    };
    const result = GoalSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject tier with invalid priority (<1)', () => {
    const invalid = {
      ...singleGoal,
      tiers: {
        basic: { targetAmount: 5000000, priority: 0 },
        ambitious: { targetAmount: 8000000, priority: 2 }
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

  it('should reject invalid amountVariancePct (>100)', () => {
    const invalid = { ...singleGoal, amountVariancePct: 150 };
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
