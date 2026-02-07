/**
 * Test scenario schema for planning methods coverage.
 *
 * This is intentionally high-level and reuses existing domain models (AssetClasses,
 * CustomerProfile, Goals, SIPInput) so that scenarios can be fed directly into
 * GoalPlanner / run-planning style drivers.
 */
import { AssetClasses } from "./AssetClass";
import { CustomerProfile } from "./CustomerProfile";
import { Goals } from "./Goal";
import { SIPInput } from "../planner/goalPlanner";

export type CorpusProfileType = "balanced_corpus" | "skewed_corpus" | "no_corpus";

export type SIPProfileType = "sip_right_amount" | "sip_stretch" | "sip_too_low";

export type GoalProfileType =
  | "single_goal"
  | "multiple_goals"
  | "reachable_goals"
  | "unreachable_goals";

export type TimelineProfileType = "long_term" | "short_term" | "mixed";

/**
 * High-level scenario classification, matching the dimensions requested in docs.
 */
export interface ScenarioClassification {
  corpusProfile: CorpusProfileType;
  sipProfile: SIPProfileType;
  goalProfile: GoalProfileType;
  timelineProfile: TimelineProfileType;
}

export type ScenarioKind = "baseline" | "edge_case";

export type EdgeCaseTag =
  | "threshold"
  | "allocation_extreme"
  | "horizon_extreme"
  | "method_divergence";

/**
 * A concrete planning scenario that can be run through any of the three methods.
 *
 * - `classification` encodes the requested permutation axes.
 * - `description` is a human-readable explanation for the report.
 * - `assetClasses`, `customerProfile`, `goals`, and `sipInput` are the actual
 *   inputs that GoalPlanner expects.
 * - `meta` can hold small derived flags useful for reporting (e.g. whether
 *   the scenario was designed to be reachable or unreachable).
 */
export interface PlanningTestScenario {
  id: string;
  name: string;
  kind: ScenarioKind;
  classification: ScenarioClassification;
  description: string;

  assetClasses: AssetClasses;
  customerProfile: CustomerProfile;
  goals: Goals;
  sipInput: SIPInput;

  /**
   * Optional metadata for reports / assertions.
   * `designedReachable` describes the intent (what we expect),
   * not what any particular method computes.
   */
  meta?: {
    designedReachableBasic: boolean;
    notes?: string;
    edgeTags?: EdgeCaseTag[];
    edgeSummary?: string;
  };
}

