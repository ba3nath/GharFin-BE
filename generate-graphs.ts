import * as fs from "fs";
import * as path from "path";
import { GoalPlanner, SIPInput } from "./src/planner/goalPlanner";
import { normalizePlanningRequest } from "./src/utils/validation";

import { generateAllMethodGraphs } from "./generate-graphs-helper";

const inputPath = path.resolve(process.argv[2] ?? "example-request.json");
const inputData: unknown = JSON.parse(fs.readFileSync(inputPath, "utf-8"));
console.log(`Using input: ${inputPath}\n`);

const parsed = normalizePlanningRequest(inputData);
if (!parsed.success) {
  console.error("Validation failed:", JSON.stringify(parsed.error.issues, null, 2));
  process.exit(1);
}

const { assetClasses, customerProfile, goals, monthlySIP, stretchSIPPercent, annualStepUpPercent, assetClassesByProfile } = parsed.data;
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

generateAllMethodGraphs(planner, goals.goals, customerProfile, assetClasses, sipInput, {
  outputDir: path.join(process.cwd(), "graphs"),
});
