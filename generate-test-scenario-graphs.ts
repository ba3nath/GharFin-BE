import * as fs from "fs";
import * as path from "path";
import { GoalPlanner, SIPInput } from "./src/planner/goalPlanner";
import { AssetClasses } from "./src/models/AssetClass";
import { CustomerProfile } from "./src/models/CustomerProfile";
import { Goals } from "./src/models/Goal";
import { generateAllMethodGraphs } from "./generate-graphs-helper";

const inputData = JSON.parse(fs.readFileSync("test-cannot-be-met-scenario.json", "utf-8"));

const assetClasses: AssetClasses = inputData.assetClasses;
const customerProfile: CustomerProfile = inputData.customerProfile;
const goals: Goals = inputData.goals;
const sipInput: SIPInput = {
  monthlySIP: inputData.monthlySIP,
  stretchSIPPercent: inputData.stretchSIPPercent || 0,
  annualStepUpPercent: inputData.annualStepUpPercent || 0,
};

const planner = new GoalPlanner({
  assetClasses,
  customerProfile,
  goals: goals.goals,
  sipInput,
});

generateAllMethodGraphs(planner, goals.goals, customerProfile, assetClasses, sipInput, {
  outputDir: path.join(process.cwd(), "graphs"),
  filePrefix: "test-scenario-",
  monteCarloPaths: { method2: 100, method3: 100 },
});

console.log("\n=== Summary ===");
console.log("Files generated:");
console.log("  - test-scenario-method1-output.json");
console.log("  - test-scenario-method2-output.json");
console.log("  - test-scenario-method3-output.json");
console.log("  - graphs/test-scenario-method1-basic-networth.html");
console.log("  - graphs/test-scenario-method1-ambitious-networth.html");
console.log("  - graphs/test-scenario-method2-basic-networth.html");
console.log("  - graphs/test-scenario-method2-ambitious-networth.html");
console.log("  - graphs/test-scenario-method3-basic-networth.html");
console.log("  - graphs/test-scenario-method3-ambitious-networth.html");
