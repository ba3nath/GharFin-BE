import * as fs from "fs";
import * as path from "path";
import { GoalPlanner } from "./src/planner/goalPlanner";
import { Goal } from "./src/models/Goal";
import { CustomerProfile } from "./src/models/CustomerProfile";
import { AssetClasses } from "./src/models/AssetClass";
import { SIPInput } from "./src/planner/goalPlanner";
import { calculateNetworthProjection } from "./src/engine/networthProjection";
import { generateNetworthGraphHTML } from "./src/utils/graphGenerator";
import { PlanningResult } from "./src/models/PlanningResult";

export interface GenerateGraphsOptions {
  outputDir: string;
  filePrefix?: string;
  monteCarloPaths?: { method2?: number; method3?: number };
  writeOutputJson?: boolean;
}

/**
 * Run all three planning methods and generate networth projection graphs.
 * Shared logic for generate-graphs.ts and generate-test-scenario-graphs.ts.
 */
export function generateAllMethodGraphs(
  planner: GoalPlanner,
  goals: Goal[],
  customerProfile: CustomerProfile,
  assetClasses: AssetClasses,
  sipInput: SIPInput,
  options: GenerateGraphsOptions
): void {
  const { outputDir, filePrefix = "", monteCarloPaths = {}, writeOutputJson = true } = options;
  const prefix = filePrefix ? `${filePrefix}` : "";

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const runMethod = (
    methodName: string,
    planFn: () => PlanningResult,
    jsonFileName: string
  ): PlanningResult => {
    console.log(`Running ${methodName}...`);
    const result = planFn();
    if (writeOutputJson) {
      fs.writeFileSync(jsonFileName, JSON.stringify(result, null, 2));
      console.log(`${methodName} output saved to ${path.basename(jsonFileName)}`);
    }
    return result;
  };

  const generateGraphsForMethod = (
    method: "method1" | "method2" | "method3",
    result: PlanningResult
  ) => {
    const methodLabel = method.charAt(0).toUpperCase() + method.slice(1);
    for (const tier of ["basic", "ambitious"] as const) {
      console.log(`Calculating networth projection for ${methodLabel} (${tier} Tier)...`);
      const projection = calculateNetworthProjection(
        method,
        result,
        goals,
        customerProfile,
        assetClasses,
        sipInput,
        tier
      );
      const tierLabel = tier === "basic" ? "basic" : "ambitious";
      const filename = `${prefix}${method}-${tierLabel}-networth.html`;
      const outputPath = path.join(outputDir, filename);
      generateNetworthGraphHTML(projection, outputPath);
      console.log(`${methodLabel} ${tier} tier graph generated: ${path.relative(process.cwd(), outputPath)}`);
    }
  };

  const method1Result = runMethod(
    "Method 1",
    () => planner.planMethod1(),
    path.join(process.cwd(), prefix ? `${prefix}method1-output.json` : "method1-output.json")
  );
  generateGraphsForMethod("method1", method1Result);
  console.log("");

  const method2Result = runMethod(
    "Method 2",
    () => planner.planMethod2(monteCarloPaths.method2 ?? 1000),
    path.join(process.cwd(), prefix ? `${prefix}method2-output.json` : "method2-output.json")
  );
  generateGraphsForMethod("method2", method2Result);
  console.log("");

  const method3Result = runMethod(
    "Method 3",
    () => planner.planMethod3(monteCarloPaths.method3 ?? 1000),
    path.join(process.cwd(), prefix ? `${prefix}method3-output.json` : "method3-output.json")
  );
  generateGraphsForMethod("method3", method3Result);

  console.log("All graphs generated successfully!");
  console.log("Open the HTML files in your browser to view the graphs.");
}
