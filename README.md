# Goal-Based SIP Optimization System

A Node.js REST API that implements the envelope method for SIP projection with Monte Carlo lite validation. The system optimizes monthly SIP allocation across multiple financial goals, ensuring 90% confidence for basic tier goals before allocating remaining SIP to ambitious tiers.

## Features

- **Envelope Method**: Fast, stable, explainable bounds for goal planning (90% confidence)
- **Monte Carlo Lite Validation**: Lightweight validation (50-100 simulations) to verify envelope assumptions
- **Two Planning Methods**:
  - **Method 1**: Calculate SIP allocation with current corpus allocation
  - **Method 2**: Rebalance entire corpus to match optimal SIP allocation ratio, then recalculate
- **Goal Prioritization**: Process goals by priority, securing basic tiers first
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
  "goals": { ... },
  "monthlySIP": 50000,
  "stretchSIPPercent": 20,
  "annualStepUpPercent": 10
}
```

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

### POST /api/validate

Validate envelope method using Monte Carlo simulation.

### GET /api/health

Health check endpoint.

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
```

### Using the test script

```bash
./test-api.sh
```

Note: The test script requires `jq` for JSON formatting. Install it with `brew install jq` on macOS.

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
