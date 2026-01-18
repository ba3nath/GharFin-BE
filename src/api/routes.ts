import { Router, Request, Response } from "express";
import { GoalPlanner, SIPInput } from "../planner/goalPlanner";
import { AssetClasses } from "../models/AssetClass";
import { CustomerProfile } from "../models/CustomerProfile";
import { Goals } from "../models/Goal";
import { validateEnvelope } from "../engine/montecarlo";
import { AssetAllocation } from "../engine/portfolio";

const router = Router();

/**
 * Request body for planning endpoints (Method 1, 2, and 3).
 * Contains all necessary inputs for goal-based SIP planning.
 */
interface PlanningRequest {
  assetClasses: AssetClasses;
  customerProfile: CustomerProfile;
  goals: Goals;
  monthlySIP: number;
  stretchSIPPercent?: number;
  annualStepUpPercent?: number;
  monteCarloPaths?: number; // Optional, only for Method 2, default 1000
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
      "assetClasses",
      "customerProfile",
      "goals",
      "monthlySIP",
      "stretchSIPPercent (optional)",
      "annualStepUpPercent (optional)",
    ],
    example: "See example-request.json file in the project root",
    note: "This endpoint requires a POST request with JSON body. Use a tool like curl, Postman, or fetch API.",
  });
});

/**
 * POST /api/plan/method1
 * Method 1: Calculate SIP allocation with current corpus allocation
 */
router.post("/plan/method1", (req: Request, res: Response) => {
  try {
    const {
      assetClasses,
      customerProfile,
      goals,
      monthlySIP,
      stretchSIPPercent,
      annualStepUpPercent,
    } = req.body as PlanningRequest;

    // Validate inputs
    if (!assetClasses || !customerProfile || !goals || monthlySIP === undefined) {
      return res.status(400).json({
        error: "Missing required fields: assetClasses, customerProfile, goals, monthlySIP",
      });
    }

    const sipInput: SIPInput = {
      monthlySIP,
      stretchSIPPercent: stretchSIPPercent || 0,
      annualStepUpPercent: annualStepUpPercent || 0,
    };

    // Create planner and execute Method 1
    const planner = new GoalPlanner({
      assetClasses,
      customerProfile,
      goals: goals.goals,
      sipInput,
    });

    const result = planner.planMethod1();

    res.json(result);
  } catch (error: any) {
    console.error("Error in Method 1 planning:", error);
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
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
      "assetClasses (with volatilityPct for all asset classes)",
      "customerProfile",
      "goals",
      "monthlySIP",
      "stretchSIPPercent (optional)",
      "annualStepUpPercent (optional)",
      "monteCarloPaths (optional, default 1000)",
    ],
    example: "See example-request.json file in the project root",
    note: "This endpoint requires a POST request with JSON body. Use a tool like curl, Postman, or fetch API. Method 2 requires volatilityPct in asset class data.",
  });
});

/**
 * POST /api/plan/method2
 * Method 2: Rebalance corpus to match SIP allocation, then recalculate
 */
router.post("/plan/method2", (req: Request, res: Response) => {
  try {
    const {
      assetClasses,
      customerProfile,
      goals,
      monthlySIP,
      stretchSIPPercent,
      annualStepUpPercent,
      monteCarloPaths,
    } = req.body as PlanningRequest;

    // Validate inputs
    if (!assetClasses || !customerProfile || !goals || monthlySIP === undefined) {
      return res.status(400).json({
        error: "Missing required fields: assetClasses, customerProfile, goals, monthlySIP",
      });
    }

    const sipInput: SIPInput = {
      monthlySIP,
      stretchSIPPercent: stretchSIPPercent || 0,
      annualStepUpPercent: annualStepUpPercent || 0,
    };

    // Create planner and execute Method 2
    const planner = new GoalPlanner({
      assetClasses,
      customerProfile,
      goals: goals.goals,
      sipInput,
    });

    const result = planner.planMethod2(monteCarloPaths || 1000);

    res.json(result);
  } catch (error: any) {
    console.error("Error in Method 2 planning:", error);
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
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
      "assetClasses (with volatilityPct for all asset classes)",
      "customerProfile",
      "goals",
      "monthlySIP",
      "stretchSIPPercent (optional)",
      "annualStepUpPercent (optional)",
      "monteCarloPaths (optional, default 1000)",
      "maxIterations (optional, default 20)",
    ],
    note: "For goals < 3 years: Allocates corpus but skips SIP calculations (SIP = 0). For goals >= 3 years: Iterates until SIP amounts converge (change < ₹1000).",
  });
});

/**
 * POST /api/plan/method3
 * Method 3: Iterative corpus rebalancing to match SIP allocation
 */
router.post("/plan/method3", (req: Request, res: Response) => {
  try {
    const {
      assetClasses,
      customerProfile,
      goals,
      monthlySIP,
      stretchSIPPercent,
      annualStepUpPercent,
      monteCarloPaths,
      maxIterations,
    } = req.body as PlanningRequest & { maxIterations?: number };

    // Validate inputs
    if (!assetClasses || !customerProfile || !goals || monthlySIP === undefined) {
      return res.status(400).json({
        error: "Missing required fields: assetClasses, customerProfile, goals, monthlySIP",
      });
    }

    const sipInput: SIPInput = {
      monthlySIP,
      stretchSIPPercent: stretchSIPPercent || 0,
      annualStepUpPercent: annualStepUpPercent || 0,
    };

    // Create planner and execute Method 3
    const planner = new GoalPlanner({
      assetClasses,
      customerProfile,
      goals: goals.goals,
      sipInput,
    });

    const result = planner.planMethod3(monteCarloPaths || 1000, maxIterations || 20);

    res.json(result);
  } catch (error: any) {
    console.error("Error in Method 3 planning:", error);
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
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
  } catch (error: any) {
    console.error("Error in validation:", error);
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
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
