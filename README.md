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

**Request Body:**
```json
{
  "assetClasses": { ... },
  "customerProfile": { ... },
  "goals": {
    "goals": [
      {
        "goalId": "goal1",
        "goalName": "Example Goal",
        "horizonYears": 10,
        "amountVariancePct": 5,
        "tiers": {
          "basic": {
            "targetAmount": 5000000,
            "priority": 1
          },
          "ambitious": {
            "targetAmount": 8000000,
            "priority": 2
          }
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
- **Run planning script**: `npx ts-node run-planning.ts [input-file]`. Default input is `example-request.json`. Writes `method1-output.json`, `method2-output.json`, and `method3-output.json` to the project root. These files are listed in `.gitignore`.
- **Request validation**: The API validates request bodies with Zod; invalid payloads return 400 with `error: "Validation failed"` and a `details` array of validation issues.

## Project Structure

```
src/
├── models/          # Data models
├── engine/          # Core engines (envelope, portfolio, montecarlo, rebalancer)
├── planner/         # Goal planner
├── api/             # REST API endpoints
└── utils/           # Utility functions
```

## Technology Stack

- **Runtime**: Node.js
- **Language**: TypeScript
- **Framework**: Express.js
- **Validation**: Zod

## License

ISC
