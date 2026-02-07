import { fullAssetClasses } from "../__tests__/fixtures/assetClasses";
import { CustomerProfile } from "../models/CustomerProfile";
import { Goal, Goals } from "../models/Goal";
import { SIPInput } from "../planner/goalPlanner";
import {
  PlanningTestScenario,
} from "../models/TestScenario";

// ---------- Realistic helper fixtures (Indian INR context) ----------

function makeCustomerProfile(params: {
  asOfDate?: string;
  corpusByAssetClass: Record<string, number>;
}): CustomerProfile {
  const asOfDate = params.asOfDate ?? "2026-01-01";
  const corpus = params.corpusByAssetClass;
  const totalNetWorth = Object.values(corpus).reduce((sum, v) => sum + v, 0);
  return {
    asOfDate,
    totalNetWorth,
    corpus: {
      byAssetClass: corpus,
      allowedAssetClasses: Object.keys(corpus),
    },
  };
}

function makeGoals(...goals: Goal[]): Goals {
  return { goals };
}

function makeSIPInput(params: {
  monthlySIP: number;
  stretchPct?: number;
  stepUpPct?: number;
}): SIPInput {
  return {
    monthlySIP: params.monthlySIP,
    stretchSIPPercent: params.stretchPct ?? 0,
    annualStepUpPercent: params.stepUpPct ?? 0,
  };
}

// Personas (very rough heuristics):
// - Mid-career couple, household income ~₹1.5L/month, saving ~30–40% via SIP.
// - Younger professional, income ~₹80k/month, saving ~20–25%.
// - Higher-income household, income ~₹3L/month, saving ~35–45%.

// Asset class assumptions come from fullAssetClasses (equity + bond + gold).

// Balanced mid-career: ~₹25L corpus, 60/30/10 equity/bond/gold
const midCareerBalancedProfile: CustomerProfile = makeCustomerProfile({
  corpusByAssetClass: {
    largeCap: 900000,
    midCap: 600000,
    smallCap: 400000,
    bond: 750000,
    gold: 350000,
  },
});

// Equity-heavy skewed: same total corpus as mid-career but 85%+ in equity
const equitySkewedProfile: CustomerProfile = makeCustomerProfile({
  corpusByAssetClass: {
    largeCap: 1400000,
    midCap: 900000,
    smallCap: 700000,
    bond: 300000,
    gold: 100000,
  },
});

// Low net-worth but skewed: sized to sit near the emergency-fund target (to trigger method divergence)
const lowNetWorthEquitySkewedProfile: CustomerProfile = makeCustomerProfile({
  corpusByAssetClass: {
    largeCap: 250000,
    midCap: 200000,
    smallCap: 150000,
    bond: 50000,
    gold: 0,
  },
});

// Debt-heavy conservative: mostly bonds with small equity sleeve
const debtHeavyProfile: CustomerProfile = makeCustomerProfile({
  corpusByAssetClass: {
    bond: 2000000,
    largeCap: 300000,
    gold: 200000,
  },
});

// Cash-only emergency corpus
const cashOnlyProfile: CustomerProfile = makeCustomerProfile({
  corpusByAssetClass: {
    cash: 500000,
  },
});

// No corpus (fresh investor)
const noCorpusProfile: CustomerProfile = makeCustomerProfile({
  corpusByAssetClass: {},
});

// Goals templates (targets roughly in lakhs/crores, INR)
const retirement30Y: Goal = {
  goalId: "retirement_30y",
  goalName: "Retirement",
  horizonYears: 30,
  amountVariancePct: 20,
  tiers: {
    basic: { targetAmount: 30000000, priority: 1 }, // ₹3 Cr
    ambitious: { targetAmount: 45000000, priority: 2 }, // ₹4.5 Cr
  },
};

const retirement40Y: Goal = {
  goalId: "retirement_40y",
  goalName: "Ultra-long Retirement",
  horizonYears: 40,
  amountVariancePct: 25,
  tiers: {
    basic: { targetAmount: 50000000, priority: 1 }, // ₹5 Cr
    ambitious: { targetAmount: 80000000, priority: 2 }, // ₹8 Cr
  },
};

const education12Y: Goal = {
  goalId: "education_12y",
  goalName: "Child Higher Education",
  horizonYears: 12,
  amountVariancePct: 15,
  tiers: {
    basic: { targetAmount: 2500000, priority: 2 }, // ₹25L
    ambitious: { targetAmount: 4000000, priority: 3 }, // ₹40L
  },
};

const car3Y: Goal = {
  goalId: "car_3y",
  goalName: "Car Purchase",
  horizonYears: 3,
  amountVariancePct: 10,
  tiers: {
    basic: { targetAmount: 1200000, priority: 3 }, // ₹12L
    ambitious: { targetAmount: 1800000, priority: 4 }, // ₹18L
  },
};

const emergency1Y: Goal = {
  goalId: "emergency_1y",
  goalName: "Emergency Fund",
  horizonYears: 1,
  amountVariancePct: 0,
  tiers: {
    basic: { targetAmount: 600000, priority: 1 }, // ₹6L (approx 6 months expenses)
    ambitious: { targetAmount: 900000, priority: 2 },
  },
};

const medical5Y: Goal = {
  goalId: "medical_5y",
  goalName: "Medical Corpus",
  horizonYears: 5,
  amountVariancePct: 10,
  tiers: {
    basic: { targetAmount: 1500000, priority: 2 }, // ₹15L
    ambitious: { targetAmount: 2500000, priority: 3 }, // ₹25L
  },
};

const house10Y: Goal = {
  goalId: "house_10y",
  goalName: "House Purchase",
  horizonYears: 10,
  amountVariancePct: 15,
  tiers: {
    basic: { targetAmount: 5000000, priority: 2 }, // ₹50L
    ambitious: { targetAmount: 8000000, priority: 3 }, // ₹80L
  },
};

const vacation3Y: Goal = {
  goalId: "vacation_3y",
  goalName: "Vacation",
  horizonYears: 3,
  amountVariancePct: 10,
  tiers: {
    basic: { targetAmount: 300000, priority: 4 }, // ₹3L
    ambitious: { targetAmount: 500000, priority: 5 }, // ₹5L
  },
};

const impossible5Y: Goal = {
  goalId: "impossible_5y",
  goalName: "Aspirational Mansion",
  horizonYears: 5,
  amountVariancePct: 0,
  tiers: {
    basic: { targetAmount: 100000000, priority: 1 }, // ₹10 Cr in 5Y
    ambitious: { targetAmount: 150000000, priority: 2 },
  },
};

// SIP levels (assume ~₹1.5L/month income baseline)
const sipRight: SIPInput = makeSIPInput({ monthlySIP: 40000, stretchPct: 20, stepUpPct: 10 }); // ~27% save rate, with stretch +10% step-up
const sipModerate: SIPInput = makeSIPInput({ monthlySIP: 30000, stretchPct: 0, stepUpPct: 5 }); // ~20% save rate
const sipModerateInsufficient: SIPInput = makeSIPInput({ monthlySIP: 8000, stretchPct: 0, stepUpPct: 5 }); // insufficient for bucket 3 goals (all methods fail)
const sipStretchHigh: SIPInput = makeSIPInput({ monthlySIP: 60000, stretchPct: 30, stepUpPct: 10 }); // aggressive
const sipTooLow: SIPInput = makeSIPInput({ monthlySIP: 10000, stretchPct: 0, stepUpPct: 0 }); // clearly insufficient for big goals
const sipNearThresholdHigh: SIPInput = makeSIPInput({ monthlySIP: 45000, stretchPct: 0, stepUpPct: 0 });
const sipNearThresholdLow: SIPInput = makeSIPInput({ monthlySIP: 38000, stretchPct: 0, stepUpPct: 0 });
const sipZero: SIPInput = makeSIPInput({ monthlySIP: 0, stretchPct: 0, stepUpPct: 0 });
const sipMinimal: SIPInput = makeSIPInput({ monthlySIP: 1000, stretchPct: 0, stepUpPct: 0 }); // Minimal SIP just to enable allocation

// Additional corpus profiles for bucket-specific scenarios
const largeBalancedCorpusProfile: CustomerProfile = makeCustomerProfile({
  corpusByAssetClass: {
    largeCap: 15000000,
    midCap: 10000000,
    smallCap: 5000000,
    bond: 10000000,
    gold: 5000000,
  },
});

const moderateSkewedCorpusProfile: CustomerProfile = makeCustomerProfile({
  corpusByAssetClass: {
    largeCap: 2000000,
    midCap: 1500000,
    smallCap: 1000000,
    bond: 500000,
    gold: 0,
  },
});

/**
 * 7 focused scenarios - one per bucket, each with at least 3 goals.
 *
 * NOTE: The ids are stable and can be used for linking in reports.
 */
export const planningTestScenarios: PlanningTestScenario[] = [
  // Bucket 1/2: Corpus/SIP is low; goal cannot be met
  {
    id: "bucket_1_2_corpus_sip_low_cannot_meet",
    name: "Bucket 1/2: Corpus/SIP low; goals cannot be met",
    kind: "baseline",
    classification: {
      corpusProfile: "no_corpus",
      sipProfile: "sip_too_low",
      goalProfile: "unreachable_goals",
      timelineProfile: "mixed",
    },
    description:
      "No starting corpus with very low SIP; multiple goals (retirement, education, house) cannot be met even with best allocation.",
    assetClasses: fullAssetClasses,
    customerProfile: noCorpusProfile,
    goals: makeGoals(retirement30Y, education12Y, house10Y),
    sipInput: sipTooLow,
    meta: {
      designedReachableBasic: false,
      notes: "Bucket 1/2: Corpus/SIP too low; all methods fail to meet all basic goals.",
    },
  },

  // Bucket 3: Corpus is skewed; goal cannot be met with the SIP
  {
    id: "bucket_3_skewed_cannot_meet_with_sip",
    name: "Bucket 3: Skewed corpus; goals cannot be met with SIP",
    kind: "baseline",
    classification: {
      corpusProfile: "skewed_corpus",
      sipProfile: "sip_right_amount",
      goalProfile: "unreachable_goals",
      timelineProfile: "mixed",
    },
    description:
      "Equity-skewed corpus with reasonable SIP, but goals (retirement, education, medical) still cannot be met due to allocation mismatch.",
    assetClasses: fullAssetClasses,
    customerProfile: equitySkewedProfile,
    goals: makeGoals(retirement30Y, education12Y, medical5Y, impossible5Y),
    sipInput: sipModerateInsufficient,
    meta: {
      designedReachableBasic: false,
      notes: "Bucket 3: Skewed corpus; at least one goal (Aspirational Mansion) cannot be met in all three methods.",
    },
  },

  // Bucket 4: Corpus is skewed; goal can be met with the SIP (method 1 or 2)
  {
    id: "bucket_4_skewed_can_meet_method1_or_2",
    name: "Bucket 4: Skewed corpus; goals can be met with SIP (method 1 or 2)",
    kind: "baseline",
    classification: {
      corpusProfile: "skewed_corpus",
      sipProfile: "sip_right_amount",
      goalProfile: "multiple_goals",
      timelineProfile: "mixed",
    },
    description:
      "Equity-skewed corpus with adequate SIP; retirement, education, and vacation goals can be met via method 1 or 2.",
    assetClasses: fullAssetClasses,
    customerProfile: makeCustomerProfile({
      corpusByAssetClass: {
        largeCap: 1800000,
        midCap: 1500000,
        smallCap: 1000000,
        bond: 700000,
        gold: 0,
      },
    }),
    goals: makeGoals(retirement30Y, education12Y, vacation3Y),
    sipInput: sipStretchHigh,
    meta: {
      designedReachableBasic: true,
      notes: "Bucket 4: Skewed corpus; all methods meet all basic goals; Method 3 has higher confidence or lower SIP than M1/M2.",
    },
  },

  // Bucket 5: Corpus is skewed; goal can be met with rebalancing (only in method 3)
  {
    id: "bucket_5_skewed_can_meet_only_method3",
    name: "Bucket 5: Skewed corpus; goals can be met only with rebalancing (method 3)",
    kind: "baseline",
    classification: {
      corpusProfile: "skewed_corpus",
      sipProfile: "sip_stretch",
      goalProfile: "multiple_goals",
      timelineProfile: "mixed",
    },
    description:
      "Equity-skewed corpus with stretch SIP; emergency, medical, and vacation goals can be met only via method 3's iterative rebalancing.",
    assetClasses: fullAssetClasses,
    customerProfile: makeCustomerProfile({
      corpusByAssetClass: {
        largeCap: 220000,
        midCap: 180000,
        smallCap: 140000,
        bond: 50000,      // Skewed: ~92% equity, 8% bond – Methods 1/2 misallocate; Emergency (1y) underfunded
        gold: 0,
      },
    }),
    goals: makeGoals(emergency1Y, medical5Y, vacation3Y),
    sipInput: makeSIPInput({ monthlySIP: 52000, stretchPct: 25, stepUpPct: 10 }),
    meta: {
      designedReachableBasic: true,
      notes: "Bucket 5: Skewed corpus; only method 3 meets all basic goals via rebalancing.",
    },
  },

  // Bucket 6: Corpus is balanced; goal cannot be met with the SIP
  {
    id: "bucket_6_balanced_cannot_meet_with_sip",
    name: "Bucket 6: Balanced corpus; goals cannot be met with SIP",
    kind: "baseline",
    classification: {
      corpusProfile: "balanced_corpus",
      sipProfile: "sip_too_low",
      goalProfile: "unreachable_goals",
      timelineProfile: "long_term",
    },
    description:
      "Balanced equity/debt corpus but SIP too low; retirement, education, and house goals cannot be met.",
    assetClasses: fullAssetClasses,
    customerProfile: makeCustomerProfile({
      corpusByAssetClass: {
        largeCap: 1590000,  // ~53% – matches Method 3 optimal allocation
        midCap: 1260000,    // ~42%
        bond: 150000,       // ~5%
        smallCap: 0,
        gold: 0,
      },
    }),
    goals: makeGoals(retirement30Y, education12Y, house10Y),
    sipInput: sipTooLow,
    meta: {
      designedReachableBasic: false,
      notes: "Bucket 6: Balanced corpus; all methods fail to meet all basic goals with the given SIP.",
    },
  },

  // Bucket 7: SIP is not needed; goal can be met with the corpus alone
  {
    id: "bucket_7_sip_not_needed_corpus_only",
    name: "Bucket 7: SIP not needed; goals can be met with corpus alone",
    kind: "baseline",
    classification: {
      corpusProfile: "balanced_corpus",
      sipProfile: "sip_too_low",
      goalProfile: "reachable_goals",
      timelineProfile: "long_term",
    },
    description:
      "Balanced corpus sufficient to meet retirement, education, and medical goals with minimal SIP (corpus does the work).",
    assetClasses: fullAssetClasses,
    customerProfile: makeCustomerProfile({
      corpusByAssetClass: {
        largeCap: 3500000,  // ~₹35L – realistic upper-middle-class corpus
        midCap: 2500000,
        smallCap: 1500000,
        bond: 2000000,
        gold: 500000,
      },
    }),
    goals: makeGoals(retirement30Y, education12Y, medical5Y),
    sipInput: makeSIPInput({ monthlySIP: 10000, stretchPct: 0, stepUpPct: 0 }), // Minimal SIP
    meta: {
      designedReachableBasic: true,
      notes: "Bucket 7: SIP not needed; at least one method meets all basic goals with corpus alone.",
    },
  },
];
