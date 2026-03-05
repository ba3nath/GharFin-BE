# Goal-Based SIP Optimization System

A Node.js REST API that implements the envelope method for SIP projection with Monte Carlo lite validation. The system optimizes monthly SIP allocation across multiple financial goals, ensuring 90% confidence for basic tier goals before allocating remaining SIP to ambitious tiers. Priorities are defined at the tier level, allowing flexible goal ordering (e.g., an ambitious tier of one goal can have higher priority than the basic tier of another goal).

## Features

- **Envelope Method**: Fast, stable, explainable bounds for goal planning (90% confidence)
- **Monte Carlo Lite Validation**: Lightweight validation (50-100 simulations) to verify envelope assumptions
- **Three Planning Methods**:
  - **Method 1**: Calculate SIP allocation with current corpus allocation
  - **Method 2**: Rebalance entire corpus to match optimal SIP allocation ratio, then recalculate
  - **Method 3**: Iterative corpus rebalancing: Calculate SIP with corpus=0, rebalance corpus to match SIP allocation, iterate until convergence
- **Tier-Level Prioritization**: Each tier (basic/ambitious) has its own priority, allowing flexible goal ordering (e.g., ambitious tier of one goal can have higher priority than basic tier of another goal)
- **Time-Based Asset Allocation**: Dynamic shift to bonds in last 12 months for basic goals
- **Sharpe Ratio Optimization**: Optimize remaining SIP for ambitious goals

## Installation

```bash
npm install
```

## Build

```bash
npm run build
```

## Run

```bash
# Development mode
npm run dev

# Production mode
npm start
```

The API will be available at `http://localhost:3000`

## API Endpoints

### GET /api

Returns API information and available endpoints.

### GET /api/plan/method1

Returns information about the Method 1 endpoint (request format, required fields).

### POST /api/plan/method1

Calculate SIP allocation with current corpus allocation.

**Request Body:** The API expects `assets` (benchmark + mutual_fund_categories) and `customer_profile` (financials, stability, risk_tolerance, liquidity_preferences), not raw assetClasses/customerProfile:

```json
{
  "assets": {
    "benchmark": { "name": "Nifty 50", "beta_reference": 1 },
    "mutual_fund_categories": [ ... ]
  },
  "customer_profile": {
    "financials": { ... },
    "stability": { ... },
    "risk_tolerance": { ... },
    "liquidity_preferences": { ... },
    "asOfDate": "2026-01-01"
  },
  "goals": {
    "goals": [
      {
        "goalId": "goal1",
        "goalName": "Example Goal",
        "horizonYears": 10,
        "amountVariancePct": 5,
        "tiers": {
          "basic": { "targetAmount": 5000000, "priority": 1 },
          "ambitious": { "targetAmount": 8000000, "priority": 2 }
        }
      }
    ]
  },
  "monthlySIP": 50000,
  "stretchSIPPercent": 20,
  "annualStepUpPercent": 10
}
```

**Note:** Each tier (basic/ambitious) has its own `priority` field. Lower numbers indicate higher priority. Basic tier priorities are used for SIP allocation order and corpus allocation. Ambitious tier priorities are used for distributing remaining SIP after basic tiers achieve 90% confidence.

See `example-request.json` for a complete example.

**Response:**
- Goal feasibility table with confidence percentages
- SIP allocation % at overall portfolio level (first month)
- SIP allocation schedule showing changes over time

### GET /api/plan/method2

Returns information about the Method 2 endpoint (request format, required fields).

### POST /api/plan/method2

Rebalance corpus to match SIP allocation, then recalculate.

**Request Body:** Same as Method 1

**Response:**
- Improvement analysis showing confidence improvements
- Goal feasibility table
- SIP allocation % and schedule
- New corpus allocation percentages

### GET /api/plan/method3

Returns information about the Method 3 endpoint (request format, required fields).

### POST /api/plan/method3

Iterative corpus rebalancing: Calculate SIP with corpus=0, rebalance corpus to match SIP allocation, iterate until convergence.

**Request Body:** Same as Method 1, with optional:
- `monteCarloPaths` (optional, default 1000)
- `maxIterations` (optional, default 20)

**Response:**
- Goal feasibility table
- SIP allocation % and schedule
- Iteration details showing convergence progress

**Note:** For goals < 3 years: Allocates corpus but skips SIP calculations (SIP = 0). For goals >= 3 years: Iterates until SIP amounts converge (change < ₹1000).

### POST /api/validate

Validate envelope method using Monte Carlo simulation.

### GET /api/health

Health check endpoint.

## Method Comparison Guide

### Method 1 Better Than Method 2 and 3: With low volatility and an optimal allocation, the envelope method's probability-based modeling is less conservative than Monte Carlo, yielding higher confidence.

**Conditions:**
- Low volatility asset classes (lower volatilityPct)
- Optimal corpus allocation (already well-distributed)
- Envelope method's probability-based approach is more accurate than Monte Carlo's volatility-based approach in this scenario

### Method 2 Better Than Method 1 and 3: With high volatility, Monte Carlo's explicit volatility modeling captures risk better than the envelope method, which can be too optimistic.

**Conditions:**
- High volatility asset classes (higher volatilityPct)
- Portfolio with significant allocation to volatile assets (midCap with 28% volatility)
- Monte Carlo's volatility-based modeling provides better risk assessment

### Method 3 Better Than Method 1 and 2: When the customer's initial allocation is very skewed to one asset class (like bonds), Method 3's iterative rebalancing from zero corpus allows optimal redistribution for better goal achievement.

**Conditions:**
- Initial corpus allocation heavily skewed to one asset class (e.g., bonds)
- Current allocation is suboptimal for long-term goals
- Iterative rebalancing approach can achieve better goal feasibility by redistributing corpus optimally

## Testing the API

### Using curl

```bash
# Test Method 1
curl -X POST http://localhost:3000/api/plan/method1 \
  -H "Content-Type: application/json" \
  -d @example-request.json

# Test Method 2
curl -X POST http://localhost:3000/api/plan/method2 \
  -H "Content-Type: application/json" \
  -d @example-request.json

# Test Method 3
curl -X POST http://localhost:3000/api/plan/method3 \
  -H "Content-Type: application/json" \
  -d @example-request.json
```

### Using the test script

```bash
./test-api.sh
```

Note: The test script requires `jq` for JSON formatting. Install it with `brew install jq` on macOS.

## Development

- **Run tests**: `npm test` (or `npm test -- --coverage` for coverage). CI can use `npm run build && npm test`.
- **Request validation**: The API validates request bodies with Zod; invalid payloads return 400 with `error: "Validation failed"` and a `details` array of validation issues.

### Scripts

| Script | Description |
|--------|-------------|
| `npx ts-node run-planning.ts [input-file]` | Run all three planning methods; default input `example-request.json`. Writes `method1-output.json`, `method2-output.json`, `method3-output.json` (gitignored). |
| `npx ts-node generate-graphs.ts [input-file]` | Run planning and generate networth projection HTML graphs in `graphs/` (gitignored). |
| `npm run generate-graphs` | Same as above (uses `example-request.json`). |
| `npx ts-node run-planning-test-scenarios.ts` | Run curated scenarios (from `src/scenarios/planningTestScenarios.ts`) through all methods; writes `docs/planning-test-scenarios-output.json` and `docs/planning-test-report.md` (gitignored). |
| `npx ts-node run-planning-bucket-summary.ts` | Reads scenario output, classifies by bucket, writes `docs/planning-bucket-summary.json` and `docs/planning-bucket-summary.md` (gitignored). |
| `npx ts-node generate-test-scenario-graphs.ts` | Generates graphs for the test scenario in `test-cannot-be-met-scenario.json`; writes `graphs/test-scenario-*.html` and `test-scenario-method*-output.json` (gitignored). |

## Code Flow Analysis

### Entry points

| Entry | File | Description |
|-------|------|-------------|
| **HTTP server** | `src/api/server.ts` | Express app: mounts `/api` routes, JSON body parsing, CORS. `npm start` runs `node dist/api/server.js`. |
| **CLI planning** | `run-planning.ts` | Reads JSON (default `example-request.json`), validates, runs all three methods, writes `method1-output.json`, `method2-output.json`, `method3-output.json`. |
| **Graph generation** | `generate-graphs.ts` | Same input as CLI; runs planning and generates HTML networth graphs via `generate-graphs-helper.ts` into `graphs/`. |

### Request → response flow (API)

1. **Request** → `src/api/routes.ts` (e.g. `POST /api/plan/method1`).
2. **Validation** → `src/utils/validation.ts`: `normalizePlanningRequest(body)` parses with Zod (`PlanningRequestSchema`), maps `assets` → `AssetClasses` and `customer_profile` → `CustomerProfile`, returns `NormalizedPlanningRequest`.
3. **Planning** → `src/planner/goalPlanner.ts`: `GoalPlanner` is constructed with asset classes, customer profile, goals, SIP input; `planMethod1()`, `planMethod2()`, or `planMethod3()` returns a `PlanningResult`.
4. **Engine usage** (inside planner):
   - **Envelope** (`src/engine/envelope.ts`): bounds, confidence, required SIP, min SIP/corpus for 90% confidence.
   - **Portfolio** (`src/engine/portfolio.ts`): time-based allocation, Sharpe optimization, weighted metrics.
   - **Monte Carlo** (`src/engine/montecarlo.ts`): Method 2/3 simulations, validation, lite multi-goal runs.
   - **Rebalancer** (`src/engine/rebalancer.ts`): corpus rebalance to SIP allocation, `optimizeCorpusAllocation`.
   - **Networth** (`src/engine/networthProjection.ts`): monthly networth projection for reporting.
5. **Response** → JSON `PlanningResult` (feasibility table, SIP plan, SIP schedule, corpus allocation).

### Input models

- **API/CLI request** (validated by `src/utils/validation.ts`):
  - **`assets`** → `AssetsConfig` (`src/models/AssetsConfig.ts`): `benchmark` + `mutual_fund_categories` (return/volatility ranges, bucket). Normalized to `AssetClasses` per profile (conservative/realistic/aggressive).
  - **`customer_profile`** → `CustomerProfileInput` (`src/models/CustomerProfileInput.ts`): `financials`, `stability`, `risk_tolerance`, `liquidity_preferences`, optional `profile_type`. Mapped to internal `CustomerProfile` (corpus, allowed asset classes, etc.).
  - **`goals`** → `GoalsSchema`: array of goals; each goal has `goalId`, `goalName`, `horizonYears`, optional `profile_type`, and `tiers.basic` / `tiers.ambitious` with `targetAmount` (range `[min, max]`, strict ordering) and `priority`.
  - **SIP params**: `monthlySIP`, optional `stretchSIPPercent`, `annualStepUpPercent`; Method 2/3 optional `monteCarloPaths`, `maxIterations`.

Internal models used by the planner (in `src/models/`): `Goal`, `CustomerProfile`, `AssetClass` / `AssetClasses`, plus envelope/portfolio types.

### Reporting and output modules

- **Structured result** (`src/models/PlanningResult.ts`): `Method1Result` | `Method2Result` | `Method3Result` — each includes:
  - **Goal feasibility** → `GoalFeasibilityTable` (`src/models/GoalFeasibilityTable.ts`): rows with goal/tier, status (`can_be_met` | `at_risk` | `cannot_be_met`), confidence %, `targetAmountRange` [min, max], projected corpus (lower/mean).
  - **SIP allocation** → `SIPPlan` (`src/models/SIPPlan.ts`): first-month allocation % by goal/tier/asset.
  - **SIP schedule** → `SIPAllocationSchedule` (`src/models/SIPAllocationSchedule.ts`): snapshots over time (e.g. step-up events).
  - **Corpus allocation** → `Record<goalId, Record<assetClass, amount>>`.

- **HTML/networth graphs**:
  - **`src/utils/graphGenerator.ts`**: `generateNetworthGraphHTML(projectionData, outputPath)` — builds Chart.js HTML from `NetworthProjectionData` (from `src/engine/networthProjection.ts`).
  - **`generate-graphs-helper.ts`**: runs Method 1/2/3, calls `calculateNetworthProjection()` per method and tier (basic/ambitious), then `generateNetworthGraphHTML()`; writes HTML under `graphs/` (and optionally JSON).

So: **entry** = server or CLI/script; **flow** = routes → validation → GoalPlanner → engine (envelope, portfolio, montecarlo, rebalancer, networth); **input models** = AssetsConfig, CustomerProfileInput, goals + SIP params; **reporting** = PlanningResult (feasibility, SIP plan/schedule, corpus) and graphGenerator + networth projection for HTML.

## Project Structure

```
src/
├── models/          # Data models (input: AssetsConfig, CustomerProfileInput; output: PlanningResult, GoalFeasibilityTable, SIPPlan, SIPAllocationSchedule)
├── engine/          # Core engines (envelope, portfolio, montecarlo, rebalancer, networthProjection)
├── planner/         # Goal planner (orchestrates engines, produces PlanningResult)
├── scenarios/      # Planning scenario definitions and bucket classifier (used by run-planning-test-scenarios, run-planning-bucket-summary)
├── api/             # REST API (server.ts, routes.ts)
└── utils/           # Validation, graphGenerator, time, math, constants
```

## Technology Stack

- **Runtime**: Node.js
- **Language**: TypeScript
- **Framework**: Express.js
- **Validation**: Zod

## License

ISC
