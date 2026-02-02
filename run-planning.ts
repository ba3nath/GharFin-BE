import * as fs from "fs";
import * as path from "path";
import { GoalPlanner, SIPInput } from "./src/planner/goalPlanner";
import { AssetClasses } from "./src/models/AssetClass";
import { CustomerProfile } from "./src/models/CustomerProfile";
import { Goals } from "./src/models/Goal";

/**
 * Run planning for all three methods and write results to method1-output.json,
 * method2-output.json, and method3-output.json (generated in project root).
 * Usage: npx ts-node run-planning.ts [input-file]
 * Default input: example-request.json
 */
const inputPath = process.argv[2] ?? "example-request.json";

let inputData: unknown;
try {
  const raw = fs.readFileSync(path.resolve(inputPath), "utf-8");
  inputData = JSON.parse(raw);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Failed to read or parse input file "${inputPath}": ${message}`);
  process.exit(1);
}

if (
  !inputData ||
  typeof inputData !== "object" ||
  !("assetClasses" in inputData) ||
  !("customerProfile" in inputData) ||
  !("goals" in inputData) ||
  typeof (inputData as { monthlySIP?: unknown }).monthlySIP !== "number"
) {
  console.error("Input file must contain assetClasses, customerProfile, goals, and monthlySIP.");
  process.exit(1);
}

const data = inputData as {
  assetClasses: AssetClasses;
  customerProfile: CustomerProfile;
  goals: Goals;
  monthlySIP: number;
  stretchSIPPercent?: number;
  annualStepUpPercent?: number;
};

const assetClasses: AssetClasses = data.assetClasses;
const customerProfile: CustomerProfile = data.customerProfile;
const goals: Goals = data.goals;
const sipInput: SIPInput = {
  monthlySIP: data.monthlySIP,
  stretchSIPPercent: data.stretchSIPPercent ?? 0,
  annualStepUpPercent: data.annualStepUpPercent ?? 0,
};

const planner = new GoalPlanner({
  assetClasses,
  customerProfile,
  goals: goals.goals,
  sipInput,
});

console.log("Running Method 1...");
const method1Result = planner.planMethod1();
fs.writeFileSync("method1-output.json", JSON.stringify(method1Result, null, 2));
console.log("Method 1 output saved to method1-output.json");

console.log("Running Method 2...");
const method2Result = planner.planMethod2();
fs.writeFileSync("method2-output.json", JSON.stringify(method2Result, null, 2));
console.log("Method 2 output saved to method2-output.json");

console.log("Running Method 3...");
const method3Result = planner.planMethod3();
fs.writeFileSync("method3-output.json", JSON.stringify(method3Result, null, 2));
console.log("Method 3 output saved to method3-output.json");

console.log("\nPlanning complete!");
