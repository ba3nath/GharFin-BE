import * as fs from "fs";
import * as path from "path";
import { GoalPlanner, SIPInput } from "./src/planner/goalPlanner";
import { AssetClasses } from "./src/models/AssetClass";
import { CustomerProfile } from "./src/models/CustomerProfile";
import { Goals } from "./src/models/Goal";
import { generateAllMethodGraphs } from "./generate-graphs-helper";

const inputPath = path.resolve(process.argv[2] ?? "example-request.json");
const inputData = JSON.parse(fs.readFileSync(inputPath, "utf-8"));
console.log(`Using input: ${inputPath}\n`);

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
});
