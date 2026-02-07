import { GoalFeasibilityRow } from "../models/GoalFeasibilityTable";
import { PlanningResult } from "../models/PlanningResult";
import { PlanningTestScenario } from "../models/TestScenario";

export type BucketKey =
  | "bucket_7_sip_not_needed_corpus_only"
  | "bucket_4_skewed_can_meet_method1_or_2"
  | "bucket_5_skewed_can_meet_only_method3"
  | "bucket_3_skewed_cannot_meet_with_sip"
  | "bucket_6_balanced_cannot_meet_with_sip"
  | "bucket_1_2_corpus_or_sip_too_low_cannot_meet";

export interface MethodResultsBundle {
  method1: PlanningResult;
  method2: PlanningResult;
  method3: PlanningResult;
}

export interface ScenarioRunResultLike {
  scenario: PlanningTestScenario;
  results: MethodResultsBundle;
}

export interface BucketClassification {
  bucket: BucketKey;
  needsReview: boolean;
  debug: {
    corpusProfile: PlanningTestScenario["classification"]["corpusProfile"];
    sipProfile: PlanningTestScenario["classification"]["sipProfile"];
    sipIsZero: boolean;
    m1_all_basic_met: boolean;
    m2_all_basic_met: boolean;
    m3_all_basic_met: boolean;
  };
}

function getAllBasicMet(rows: GoalFeasibilityRow[]): boolean {
  const basicRows = rows.filter((r) => r.tier === "basic");
  return basicRows.length > 0 && basicRows.every((r) => r.status === "can_be_met");
}

/**
 * Classify a planning scenario run into one of the user-defined buckets.
 *
 * Notes:
 * - Bucket (1) and (2) are treated as the same combined class (1/2).
 * - Matching is ordered: first rule wins.
 * - If a scenario is successful but doesn't match a specific success bucket,
 *   we fall back to bucket 7 and mark it as `needsReview`.
 */
export function classifyScenarioBucket(run: ScenarioRunResultLike): BucketClassification {
  const { scenario, results } = run;
  const { corpusProfile, sipProfile } = scenario.classification;
  const sipIsZero = scenario.sipInput.monthlySIP === 0;

  const m1_all_basic_met = getAllBasicMet(results.method1.goalFeasibilityTable.rows);
  const m2_all_basic_met = getAllBasicMet(results.method2.goalFeasibilityTable.rows);
  const m3_all_basic_met = getAllBasicMet(results.method3.goalFeasibilityTable.rows);
  const any_method_met = m1_all_basic_met || m2_all_basic_met || m3_all_basic_met;

  // Bucket 7 – SIP not needed, corpus-only
  if (any_method_met && (sipIsZero || sipProfile === "sip_too_low")) {
    return {
      bucket: "bucket_7_sip_not_needed_corpus_only",
      needsReview: false,
      debug: { corpusProfile, sipProfile, sipIsZero, m1_all_basic_met, m2_all_basic_met, m3_all_basic_met },
    };
  }

  // Bucket 4 – Skewed corpus; can be met with SIP (method 1 or 2)
  if (corpusProfile === "skewed_corpus" && (m1_all_basic_met || m2_all_basic_met)) {
    return {
      bucket: "bucket_4_skewed_can_meet_method1_or_2",
      needsReview: false,
      debug: { corpusProfile, sipProfile, sipIsZero, m1_all_basic_met, m2_all_basic_met, m3_all_basic_met },
    };
  }

  // Bucket 5 – Skewed corpus; can be met only in method 3
  if (
    corpusProfile === "skewed_corpus" &&
    !m1_all_basic_met &&
    !m2_all_basic_met &&
    m3_all_basic_met
  ) {
    return {
      bucket: "bucket_5_skewed_can_meet_only_method3",
      needsReview: false,
      debug: { corpusProfile, sipProfile, sipIsZero, m1_all_basic_met, m2_all_basic_met, m3_all_basic_met },
    };
  }

  // Bucket 3 – Skewed corpus; cannot be met with SIP
  if (corpusProfile === "skewed_corpus" && !any_method_met) {
    return {
      bucket: "bucket_3_skewed_cannot_meet_with_sip",
      needsReview: false,
      debug: { corpusProfile, sipProfile, sipIsZero, m1_all_basic_met, m2_all_basic_met, m3_all_basic_met },
    };
  }

  // Bucket 6 – Balanced corpus; cannot be met with SIP
  if (corpusProfile === "balanced_corpus" && !any_method_met) {
    return {
      bucket: "bucket_6_balanced_cannot_meet_with_sip",
      needsReview: false,
      debug: { corpusProfile, sipProfile, sipIsZero, m1_all_basic_met, m2_all_basic_met, m3_all_basic_met },
    };
  }

  // Bucket 1/2 – Corpus/SIP too low (combined); goals cannot be met
  if (!any_method_met) {
    return {
      bucket: "bucket_1_2_corpus_or_sip_too_low_cannot_meet",
      needsReview: false,
      debug: { corpusProfile, sipProfile, sipIsZero, m1_all_basic_met, m2_all_basic_met, m3_all_basic_met },
    };
  }

  // Default guard: successful but doesn't map cleanly into the provided buckets.
  // The user didn't provide explicit "balanced/no_corpus + SIP-supported success" buckets.
  // We classify into bucket 7 as the closest match and flag for review.
  return {
    bucket: "bucket_7_sip_not_needed_corpus_only",
    needsReview: true,
    debug: { corpusProfile, sipProfile, sipIsZero, m1_all_basic_met, m2_all_basic_met, m3_all_basic_met },
  };
}

