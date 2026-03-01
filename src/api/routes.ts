import { Router, Request, Response } from "express";
import { GoalPlanner, SIPInput } from "../planner/goalPlanner";
import { validateEnvelope } from "../engine/montecarlo";
import { AssetAllocation } from "../engine/portfolio";
import { normalizePlanningRequest } from "../utils/validation";

const router = Router();

function validationErrorResponse(error: { issues: unknown }) {
  return {
    error: "Validation failed",
    details: error.issues,
  };
}

/**
 * GET /api/plan/method1
 * Get information about Method 1 endpoint
 */
router.get("/plan/method1", (req: Request, res: Response) => {
  res.json({
    method: "POST",
    description: "Calculate SIP allocation with current corpus allocation",
    endpoint: "/api/plan/method1",
    requiredFields: [
      "assets (benchmark + mutual_fund_categories)",
      "customer_profile",
      "goals",
      "monthlySIP",
      "stretchSIPPercent (optional)",
      "annualStepUpPercent (optional)",
    ],
    example: "See example-request.json in the project root",
    note: "POST with JSON body. Requires assets and customer_profile.",
  });
});

/**
 * POST /api/plan/method1
 * Method 1: Calculate SIP allocation with current corpus allocation
 */
router.post("/plan/method1", (req: Request, res: Response) => {
  try {
    const parsed = normalizePlanningRequest(req.body);
    if (!parsed.success) {
      return res.status(400).json(validationErrorResponse(parsed.error));
    }
    const { assetClasses, customerProfile, goals, monthlySIP, stretchSIPPercent, annualStepUpPercent, assetClassesByProfile } =
      parsed.data;

    const sipInput: SIPInput = {
      monthlySIP,
      stretchSIPPercent: stretchSIPPercent ?? 0,
      annualStepUpPercent: annualStepUpPercent ?? 0,
    };

    const planner = new GoalPlanner({
      assetClasses,
      customerProfile,
      goals: goals.goals,
      sipInput,
      assetClassesByProfile,
    });

    const result = planner.planMethod1();
    res.json(result);
  } catch (error: unknown) {
    console.error("Error in Method 1 planning:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({
      error: "Internal server error",
      message,
    });
  }
});

/**
 * GET /api/plan/method2
 * Get information about Method 2 endpoint
 */
router.get("/plan/method2", (req: Request, res: Response) => {
  res.json({
    method: "POST",
    description: "Monte Carlo simulation-based planning using volatilityPct",
    endpoint: "/api/plan/method2",
    requiredFields: [
      "assets",
      "customer_profile",
      "goals",
      "monthlySIP",
      "monteCarloPaths (optional, default 1000)",
    ],
    example: "See example-request.json",
    note: "Requires assets and customer_profile. Method 2 uses volatility from asset data.",
  });
});

/**
 * POST /api/plan/method2
 * Method 2: Rebalance corpus to match SIP allocation, then recalculate
 */
router.post("/plan/method2", (req: Request, res: Response) => {
  try {
    const parsed = normalizePlanningRequest(req.body);
    if (!parsed.success) {
      return res.status(400).json(validationErrorResponse(parsed.error));
    }
    const {
      assetClasses,
      customerProfile,
      goals,
      monthlySIP,
      stretchSIPPercent,
      annualStepUpPercent,
      monteCarloPaths,
      assetClassesByProfile,
    } = parsed.data;

    const sipInput: SIPInput = {
      monthlySIP,
      stretchSIPPercent: stretchSIPPercent ?? 0,
      annualStepUpPercent: annualStepUpPercent ?? 0,
    };

    const planner = new GoalPlanner({
      assetClasses,
      customerProfile,
      goals: goals.goals,
      sipInput,
      assetClassesByProfile,
    });

    const result = planner.planMethod2(monteCarloPaths ?? 1000);
    res.json(result);
  } catch (error: unknown) {
    console.error("Error in Method 2 planning:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({
      error: "Internal server error",
      message,
    });
  }
});

/**
 * GET /api/plan/method3
 * Get information about Method 3 endpoint
 */
router.get("/plan/method3", (req: Request, res: Response) => {
  res.json({
    method: "POST",
    description: "Iterative corpus rebalancing: Calculate SIP with corpus=0, rebalance corpus to match SIP allocation, iterate until convergence",
    endpoint: "/api/plan/method3",
    requiredFields: [
      "assets",
      "customer_profile",
      "goals",
      "monthlySIP",
      "monteCarloPaths (optional)",
      "maxIterations (optional, default 20)",
    ],
    note: "Requires assets and customer_profile. For goals < 3 years: allocates corpus only. For goals >= 3 years: iterates until SIP converges.",
  });
});

/**
 * POST /api/plan/method3
 * Method 3: Iterative corpus rebalancing to match SIP allocation
 */
router.post("/plan/method3", (req: Request, res: Response) => {
  try {
    const parsed = normalizePlanningRequest(req.body);
    if (!parsed.success) {
      return res.status(400).json(validationErrorResponse(parsed.error));
    }
    const {
      assetClasses,
      customerProfile,
      goals,
      monthlySIP,
      stretchSIPPercent,
      annualStepUpPercent,
      monteCarloPaths,
      maxIterations,
      assetClassesByProfile,
    } = parsed.data;

    const sipInput: SIPInput = {
      monthlySIP,
      stretchSIPPercent: stretchSIPPercent ?? 0,
      annualStepUpPercent: annualStepUpPercent ?? 0,
    };

    const planner = new GoalPlanner({
      assetClasses,
      customerProfile,
      goals: goals.goals,
      sipInput,
      assetClassesByProfile,
    });

    const result = planner.planMethod3(monteCarloPaths ?? 1000, maxIterations ?? 20);
    res.json(result);
  } catch (error: unknown) {
    console.error("Error in Method 3 planning:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({
      error: "Internal server error",
      message,
    });
  }
});

/**
 * POST /api/validate
 * Validate envelope method using Monte Carlo simulation
 */
router.post("/validate", (req: Request, res: Response) => {
  try {
    const {
      initialCorpus,
      monthlySIP,
      allocations,
      assetClassDataMap,
      horizonYears,
      envelopeBounds,
    } = req.body;

    if (
      initialCorpus === undefined ||
      monthlySIP === undefined ||
      !allocations ||
      !assetClassDataMap ||
      horizonYears === undefined ||
      !envelopeBounds
    ) {
      return res.status(400).json({
        error: "Missing required fields for validation",
      });
    }

    const validation = validateEnvelope(
      initialCorpus,
      monthlySIP,
      allocations as AssetAllocation[],
      assetClassDataMap,
      horizonYears,
      envelopeBounds
    );

    res.json(validation);
  } catch (error: unknown) {
    console.error("Error in validation:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({
      error: "Internal server error",
      message,
    });
  }
});

/**
 * GET /api
 * API information endpoint
 */
router.get("/", (req: Request, res: Response) => {
  res.json({
    message: "Goal-based SIP Optimization API",
    version: "1.0.0",
    endpoints: {
      method1: "POST /api/plan/method1 - Calculate SIP allocation with envelope method",
      method2: "POST /api/plan/method2 - Monte Carlo simulation-based planning",
      method3: "POST /api/plan/method3 - Iterative corpus rebalancing to match SIP allocation",
      validate: "POST /api/validate - Validate envelope method with Monte Carlo",
      health: "GET /api/health - Health check",
    },
  });
});

/**
 * GET /api/health
 * Health check endpoint
 */
router.get("/health", (req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

export default router;
