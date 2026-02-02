/**
 * Shared constants for goal planning.
 * Centralizing these makes behavior consistent and easier to tune.
 */

/** SIP amount change below this (₹) is treated as convergence. */
export const SIP_TOLERANCE = 1000;

/** Default maximum iterations for corpus/SIP convergence loops. */
export const DEFAULT_MAX_ITERATIONS = 20;

/** Goals with horizon strictly below this (years) are short-term; SIP is not allocated. */
export const SHORT_TERM_HORIZON_YEARS = 3;

/** Confidence percent at or above this is "can_be_met" for basic tier. */
export const CONFIDENCE_CAN_BE_MET = 90;

/** Confidence percent at or above this (and below CONFIDENCE_CAN_BE_MET) is "at_risk". */
export const CONFIDENCE_AT_RISK_MIN = 50;
