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
 * GET /api/plan/gharfin
 * Get information about GharFin planning endpoint
 */
router.get("/plan/gharfin", (req: Request, res: Response) => {
  res.json({
    method: "POST",
    description: "GharFin method: Monte Carlo simulation-based planning (95% confidence on goal max, volatilityPct required)",
    endpoint: "/api/plan/gharfin",
    requiredFields: [
      "assets",
      "customer_profile",
      "goals",
      "monthlySIP",
      "monteCarloPaths (optional, default 1000)",
    ],
    example: "See example-request.json",
    note: "Requires assets and customer_profile. Uses volatility from asset data. Goal duration is fully considered.",
  });
});

/**
 * POST /api/plan/gharfin
 * GharFin method: Monte Carlo with Phase 1 (zero corpus, unlimited SIP) then Phase 2 (actual corpus + SIP)
 */
router.post("/plan/gharfin", (req: Request, res: Response) => {
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
    console.error("Error in GharFin planning:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({
      error: "Internal server error",
      message,
    });
  }
});

/** @deprecated Use POST /api/plan/gharfin. Kept for backward compatibility. */
router.get("/plan/method2", (req: Request, res: Response) => {
  res.json({
    method: "POST",
    description: "Deprecated: use /api/plan/gharfin. Same as GharFin method.",
    endpoint: "/api/plan/method2",
    redirect: "/api/plan/gharfin",
  });
});

/** @deprecated Use POST /api/plan/gharfin. Kept for backward compatibility. */
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
    console.error("Error in GharFin planning (method2):", error);
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
      gharfin: "POST /api/plan/gharfin - GharFin method (Monte Carlo, 95% confidence on goal max)",
      method2: "POST /api/plan/method2 - (deprecated) Use /api/plan/gharfin",
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
