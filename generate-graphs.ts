import * as fs from "fs";
import * as path from "path";
import { GoalPlanner, SIPInput } from "./src/planner/goalPlanner";
import { AssetClasses } from "./src/models/AssetClass";
import { CustomerProfile } from "./src/models/CustomerProfile";
import { Goals } from "./src/models/Goal";
import { calculateNetworthProjection } from "./src/engine/networthProjection";
import { generateNetworthGraphHTML } from "./src/utils/graphGenerator";

// Read input from example-request.json
const inputData = JSON.parse(fs.readFileSync("example-request.json", "utf-8"));

const assetClasses: AssetClasses = inputData.assetClasses;
const customerProfile: CustomerProfile = inputData.customerProfile;
const goals: Goals = inputData.goals;
const sipInput: SIPInput = {
  monthlySIP: inputData.monthlySIP,
  stretchSIPPercent: inputData.stretchSIPPercent || 0,
  annualStepUpPercent: inputData.annualStepUpPercent || 0,
};

// Create planner
const planner = new GoalPlanner({
  assetClasses,
  customerProfile,
  goals: goals.goals,
  sipInput,
});

// Create graphs directory
const graphsDir = path.join(process.cwd(), "graphs");
if (!fs.existsSync(graphsDir)) {
  fs.mkdirSync(graphsDir, { recursive: true });
}

// Run Method 1 and generate graphs
console.log("Running Method 1...");
const method1Result = planner.planMethod1();
fs.writeFileSync("method1-output.json", JSON.stringify(method1Result, null, 2));
console.log("Method 1 output saved to method1-output.json");

// Generate basic tier graph
console.log("Calculating networth projection for Method 1 (Basic Tier)...");
const method1ProjectionBasic = calculateNetworthProjection(
  "method1",
  method1Result,
  goals.goals,
  customerProfile,
  assetClasses,
  sipInput,
  "basic"
);
generateNetworthGraphHTML(method1ProjectionBasic, path.join(graphsDir, "method1-basic-networth.html"));
console.log("Method 1 basic tier graph generated: graphs/method1-basic-networth.html");

// Generate ambitious tier graph
console.log("Calculating networth projection for Method 1 (Ambitious Tier)...");
const method1ProjectionAmbitious = calculateNetworthProjection(
  "method1",
  method1Result,
  goals.goals,
  customerProfile,
  assetClasses,
  sipInput,
  "ambitious"
);
generateNetworthGraphHTML(method1ProjectionAmbitious, path.join(graphsDir, "method1-ambitious-networth.html"));
console.log("Method 1 ambitious tier graph generated: graphs/method1-ambitious-networth.html\n");

// Run Method 2 and generate graphs
console.log("Running Method 2...");
const method2Result = planner.planMethod2();
fs.writeFileSync("method2-output.json", JSON.stringify(method2Result, null, 2));
console.log("Method 2 output saved to method2-output.json");

// Generate basic tier graph
console.log("Calculating networth projection for Method 2 (Basic Tier)...");
const method2ProjectionBasic = calculateNetworthProjection(
  "method2",
  method2Result,
  goals.goals,
  customerProfile,
  assetClasses,
  sipInput,
  "basic"
);
generateNetworthGraphHTML(method2ProjectionBasic, path.join(graphsDir, "method2-basic-networth.html"));
console.log("Method 2 basic tier graph generated: graphs/method2-basic-networth.html");

// Generate ambitious tier graph
console.log("Calculating networth projection for Method 2 (Ambitious Tier)...");
const method2ProjectionAmbitious = calculateNetworthProjection(
  "method2",
  method2Result,
  goals.goals,
  customerProfile,
  assetClasses,
  sipInput,
  "ambitious"
);
generateNetworthGraphHTML(method2ProjectionAmbitious, path.join(graphsDir, "method2-ambitious-networth.html"));
console.log("Method 2 ambitious tier graph generated: graphs/method2-ambitious-networth.html\n");

// Run Method 3 and generate graphs
console.log("Running Method 3...");
const method3Result = planner.planMethod3();
fs.writeFileSync("method3-output.json", JSON.stringify(method3Result, null, 2));
console.log("Method 3 output saved to method3-output.json");

// Generate basic tier graph
console.log("Calculating networth projection for Method 3 (Basic Tier)...");
const method3ProjectionBasic = calculateNetworthProjection(
  "method3",
  method3Result,
  goals.goals,
  customerProfile,
  assetClasses,
  sipInput,
  "basic"
);
generateNetworthGraphHTML(method3ProjectionBasic, path.join(graphsDir, "method3-basic-networth.html"));
console.log("Method 3 basic tier graph generated: graphs/method3-basic-networth.html");

// Generate ambitious tier graph
console.log("Calculating networth projection for Method 3 (Ambitious Tier)...");
const method3ProjectionAmbitious = calculateNetworthProjection(
  "method3",
  method3Result,
  goals.goals,
  customerProfile,
  assetClasses,
  sipInput,
  "ambitious"
);
generateNetworthGraphHTML(method3ProjectionAmbitious, path.join(graphsDir, "method3-ambitious-networth.html"));
console.log("Method 3 ambitious tier graph generated: graphs/method3-ambitious-networth.html\n");

console.log("All graphs generated successfully!");
console.log("Open the HTML files in your browser to view the graphs.");
