import * as fs from "fs";
import { GoalPlanner, SIPInput } from "./src/planner/goalPlanner";
import { AssetClasses } from "./src/models/AssetClass";
import { CustomerProfile } from "./src/models/CustomerProfile";
import { Goals } from "./src/models/Goal";

// Read input from example-request.json
const inputData = JSON.parse(fs.readFileSync("example-request.json", "utf-8"));

const assetClasses: AssetClasses = inputData.assetClasses;
const customerProfile: CustomerProfile = inputData.customerProfile;
const goals: Goals = inputData.goals;
const sipInput: SIPInput = {
  monthlySIP: inputData.monthlySIP,
  stretchSIPPercent: inputData.stretchSIPPercent,
  annualStepUpPercent: inputData.annualStepUpPercent,
};

// Create planner
const planner = new GoalPlanner({
  assetClasses,
  customerProfile,
  goals: goals.goals,
  sipInput,
});

// Run Method 1
console.log("Running Method 1...");
const method1Result = planner.planMethod1();
fs.writeFileSync("method1-output.json", JSON.stringify(method1Result, null, 2));
console.log("Method 1 output saved to method1-output.json");

// Run Method 2
console.log("Running Method 2...");
const method2Result = planner.planMethod2();
fs.writeFileSync("method2-output.json", JSON.stringify(method2Result, null, 2));
console.log("Method 2 output saved to method2-output.json");

// Run Method 3
console.log("Running Method 3...");
const method3Result = planner.planMethod3();
fs.writeFileSync("method3-output.json", JSON.stringify(method3Result, null, 2));
console.log("Method 3 output saved to method3-output.json");

console.log("\nPlanning complete!");
