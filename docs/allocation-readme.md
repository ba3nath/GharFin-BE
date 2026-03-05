# Request JSON & GharFin Method SIP Logic

This document explains the structure of the planning request JSON and how the **GharFin method** determines the SIP amount per goal and the SIP percentage per asset class.

---

## 1. Request JSON Structure

The planning API accepts a JSON body with the following top-level sections. The example below follows `example-request.json`; the API may normalize alternative shapes (e.g. `financials` / `stability`) into this internal model.

### 1.1 `assets`

Defines the benchmark and the universe of mutual fund categories used for planning.

| Field | Description |
|-------|-------------|
| **`benchmark`** | Reference index = Nifty 50. `beta_reference` is typically 1. |
| **`mutual_fund_categories`** | Array of category definitions. Each category can be used as an asset class. |

**Per category:**

| Field | Description |
|-------|-------------|
| `category` | Display name (e.g. "Large Cap Fund", "Gold ETF / Gold Fund"). |
| `expected_return_cagr_range` | `{ min, max }` — CAGR range (e.g. 0.12–0.14 = 12–14%). |
| `beta_range` | `{ min, max }` — Beta vs benchmark. |
| `volatility_range` | `{ min, max }` — Volatility (e.g. 0.18–0.22). **Required for GharFin** (used for Monte Carlo). |
| `max_positive_year` | Upper bound for a good year (e.g. 0.75). |
| `max_negative_year` | Lower bound for a bad year (e.g. -0.5). |
| `probability_negative_year` | Probability of a negative year (0–1). |
| `bucket` | Optional: `"equity"` \| `"debt"` \| `"gold"`. Used to map customer’s existing allocation (equity/debt/gold/real_estate) to these categories. |

Categories are converted into internal **asset classes** (keyed by `category` name). There is **no 3Y/5Y/10Y split**: the same CAGR (and volatility) from the given ranges is used for all horizons. Return and volatility are chosen from the ranges using the customer/goal **profile type** (conservative / realistic / aggressive). For the **GharFin method**, `volatility_range` is required so that `volatilityPct` is available for the lognormal Monte Carlo model.

**Why no 3Y / 5Y / 10Y horizons?**  
Asset data is flat: `getAssetClassData(assetClasses, assetClassName)` takes only the asset class name and returns the same data for every goal. Goal **horizon in years** is still used where it matters (e.g. time-based allocation in the last 12 months, or years in Monte Carlo), but not to select different return/volatility by horizon.

---

### 1.2 `customer_profile`

Describes current wealth, cashflows, and constraints. It can be provided in different shapes; the internal model includes:

- **Net worth**: e.g. `networth.current_networth`, `networth.investments`, and **existing_asset_allocation** (equity / debt / gold / real_estate percentages that sum to 100). This is used to derive **corpus by asset class** using the `bucket` mapping from `assets`.
- **Cashflow**: e.g. `cashflow.monthly_income`, `cashflow.monthly_expenses`, `cashflow.monthly_surplus`, **sip_capacity**.
- **Risk / preferences**: e.g. `max_acceptable_drawdown_percent`, `rebalancing_preference`, `emergency_fund_months`, `debt_obligations`.

From this, the planner derives:

- **Total corpus** and **corpus by asset class** (using existing_asset_allocation and bucket → category mapping).
- **Allowed asset classes**: which categories the customer is allowed to use, based on risk tolerance and asset-class risk (volatility, drawdown). For GharFin, every allowed asset class must have **volatilityPct** (from `volatility_range`).

---

### 1.3 `goals`

List of financial goals, each with:

| Field | Description |
|-------|-------------|
| `goalId` | Unique id (e.g. `"medical_corpus"`, `"child_education"`). |
| `goalName` | Display name. |
| `horizonYears` | Years until goal. Goals with **horizon &lt; 3 years** are short-term: no SIP, only corpus allocation. |
| `profile_type` | Optional: `"conservative"` \| `"realistic"` \| `"aggressive"`. Drives which return/volatility assumptions (from asset ranges) are used **for this goal**. Default: conservative. |
| `tiers` | **basic** and **ambitious**, each with: |
| → `targetAmount` | `[min, max]` in INR. |
| → `priority` | Integer; lower = higher priority. Used to order goals for corpus and SIP allocation. |

Planning secures **basic** tier first (target 95% confidence on the goal’s **max** target amount), then allocates remaining SIP to **ambitious** where applicable.

---

### 1.4 Top-level SIP parameters

| Field | Description |
|-------|-------------|
| `monthlySIP` | Base monthly SIP (INR). |
| `stretchSIPPercent` | Optional. Extra SIP capacity as % (e.g. 20 → 20% more). **Available SIP** = `monthlySIP * (1 + stretchSIPPercent/100)`. |
| `annualStepUpPercent` | Optional. Annual increase in SIP (e.g. 10 → 10% per year). Used in projections and Monte Carlo. |

---

## 2. GharFin method: High-level flow

The GharFin method uses **Monte Carlo (lognormal paths)** and **volatility** for each asset class. It works in two phases:

1. **Phase 1 – Minimum SIP and optimal corpus mix (corpus = 0, unlimited SIP)**  
   See [§ Phase 1 logic (detailed)](#phase-1-logic-detailed) below.

2. **Phase 2 – Apply actual corpus and SIP constraints**  
   - Allocate the customer’s **actual corpus** using the optimal mix from Phase 1 (same % per goal and per asset class).  
   - With the **SIP constraint** (max SIP = base + stretch), allocate SIP to goals by priority.  
   - Build feasibility: which goals can be met with this corpus + SIP.

So: **SIP % per asset class for a goal** = that goal’s **optimal asset allocation %**. The “optimal corpus allocation” is the mix (by goal and asset class) from Phase 1; Phase 2 uses that mix to split real corpus and then determines which goals can be met under the given SIP.

---

### Phase 1 logic (detailed)

Phase 1 finds the **minimum SIP amount** (with **optimal SIP allocation %** and **step-up**) that can reach all basic-tier goals, and the **optimal corpus allocation** (the mix by goal and asset class). It does **not** use the customer's SIP cap or current corpus. **Goal duration (horizon)** is fully considered: each goal’s horizon in years drives the projection length and the required SIP.

**Inputs (conceptually):**
- Long-term goals only (horizon ≥ 3 years).
- Corpus = **0** for every goal.
- SIP = **unlimited** (no cap).
- Same **annual step-up %** and **asset assumptions** as the rest of the GharFin method.

**Steps:**

1. **Per-goal minimum required SIP**  
   For each long-term goal, with **corpus = 0** and that goal's **optimal asset allocation %** (from `getOptimalAllocation`), compute the **minimum monthly SIP** needed so that, with **step-up** applied, the basic-tier **max** target (upper bound of `targetAmount`) is reached at **95% confidence**. This is done via **Monte Carlo** (optionally with fewer paths for a lighter run): `calculateRequiredSIPMonteCarlo(targetMax, {}, assetAllocation, assetClassDataMap, horizonYears, paths, …, annualStepUpPercent)`.  
   So we get one **required SIP (₹/month)** per goal. Step-up is already included; the target is the goal’s **max** range (not the min). Goal duration (horizon in years) is used for the projection length.

2. **Allocate "unlimited" SIP**  
   Because SIP is unlimited, we assign each goal **exactly** its required amount (no priority-based cut). So:
   - **Minimum total SIP** = sum of required SIP over all long-term goals.
   - **Optimal SIP allocation %** for goal *i* = (required SIP for goal *i*) / (minimum total SIP).  
   These amounts and percentages are the "ideal" allocation when there is no SIP constraint.

3. **Optimal corpus allocation (the mix)**  
   We define how **any** future corpus would be split across goals and asset classes so it matches this SIP allocation:
   - Split corpus across goals in proportion to **goal corpus requirements** derived from the same SIP shares (e.g. present-value–based or proportional to required SIP).
   - Within each goal, split that goal's corpus by **asset class** using that goal's **optimal asset allocation %** (same as the SIP % for that goal).  
   With **total corpus = 0**, this step only defines the **structure** (which asset classes per goal); the actual amounts are zero. That structure is the **optimal corpus allocation** used in Phase 2.

4. **Iteration (for consistency)**  
   We iterate: (a) compute required SIP per goal with current corpus, (b) allocate unlimited SIP to each goal, (c) rebalance corpus to match those SIP allocations (with 0 total we get the same mix). With corpus always 0, required SIP does not change after the first iteration, so the process converges quickly.

**Outputs of Phase 1:**
- **Minimum SIP per goal** (₹/month) and **minimum total SIP**.
- **Optimal SIP allocation %** per goal (and thus per asset class per goal, via `getOptimalAllocation`).
- **Optimal corpus allocation**: the rule/mix for splitting any corpus by goal and by asset class (used in Phase 2 with the customer's actual corpus).

Phase 2 then takes the customer's **actual corpus** and **actual SIP cap** (max SIP), applies this optimal corpus mix and allocates SIP by priority, and determines **which goals can be met**.

---

## 3. How SIP % per asset class and per goal is determined (GharFin)

### 3.1 Optimal asset allocation % (per goal)

For each **long-term goal** (horizon ≥ 3 years), the GharFin method gets an **optimal asset allocation** — i.e. the **SIP allocation %** by asset class for that goal — from:

1. **Allowed asset classes**  
   From the customer profile and risk tolerance; only these categories are considered.

2. **Single asset data per class**  
   One set of return/volatility per asset class is used (no 3Y/5Y/10Y). `getAssetClassData(assetClasses, assetClassName)` returns that data.

3. **Sharpe-ratio style optimization**  
   `getOptimalAllocation()` uses `optimizeSharpeRatio()`:
   - For each allowed asset class (excluding cash), it gets **return** and **volatility** from the asset-class data.
   - Volatility can be derived from risk metrics (e.g. expected shortfall, probability of negative year) when `volatilityPct` is not present; for GharFin, **volatilityPct** from the request’s `volatility_range` is used.
   - It computes a Sharpe ratio (return / volatility) and allocates **percentages** so that higher-Sharpe assets get higher weight, with a minimum allocation (e.g. 5%) per asset.
   - Weights are normalized to sum to 100%.

4. **Time-based adjustment (basic tier only)**  
   For **basic** tier, `getTimeBasedAllocation()` is applied: in the **last 12 months** before the goal, allocation shifts toward bonds (e.g. 80% bonds). So the **SIP % per asset class** for a goal can change over time in the schedule; the “optimal” allocation above is the growth-phase allocation.

Result: for each goal we have an **asset allocation** = list of `{ assetClass, percentage }` that sums to 100%. This is the **SIP % by asset class for that goal**.

---

### 3.2 SIP amount per goal (basic tier)

The GharFin method uses **Monte Carlo** to find the **required monthly SIP** for each long-term goal so that the **basic** target (goal’s **max** amount) is met at **95% confidence**:

1. **Per goal**  
   - Corpus for that goal = current **optimized corpus** allocated to that goal (by asset class).  
   - Target = basic tier `targetAmount` (e.g. max of the range).  
   - Optimal allocation % for that goal (above) and asset-class data (with **volatilityPct**) are used.  
   - `calculateRequiredSIPMonteCarlo()` runs many lognormal paths (with optional step-up) and finds the minimum monthly SIP such that in enough paths (95%) the corpus at horizon meets or exceeds the target.

2. **Priority order**  
   Goals are processed in **basic tier priority** order. If **total required SIP ≤ available SIP** (base + stretch), each goal gets its required SIP. If not, SIP is allocated in priority order until capacity is used; lower-priority goals may get less than required (or zero).

3. **Convergence loop**  
   - **Available SIP** = `monthlySIP * (1 + stretchSIPPercent/100)`.  
   - With current corpus allocation, compute required SIP per goal and allocate SIP (as above).  
   - **Rebalance corpus** so that for each long-term goal, corpus by asset class matches that goal’s **optimal allocation %** (see below).  
   - Recompute required SIP with the new corpus; repeat until per-goal SIP changes by less than a tolerance (or max iterations).

So the **SIP amount per goal** is the outcome of this iterative, priority-based allocation; the **SIP % per asset class for that goal** is exactly the goal’s optimal allocation %.

---

### 3.3 Corpus rebalancing to match SIP allocation %

After each iteration’s SIP allocation, the GharFin method rebalances **corpus** so it is aligned with the same **allocation %** used for SIP:

1. **Corpus available for long-term goals**  
   Total corpus minus corpus already assigned to **short-term** goals (horizon &lt; 3 years).

2. **Per-goal corpus share**  
   A present-value-based (or similar) split of this available corpus across long-term goals (e.g. `computePVBasedGoalRequirements`) gives each goal a **corpus amount**.

3. **Per goal: corpus by asset class = allocation %**  
   For each long-term goal, the same **optimal allocation** (the SIP % by asset class) is used:
   - `corpus_for_goal[assetClass] = goal_corpus_amount * (allocation.percentage / 100)`  
   So corpus is rebalanced to **match the SIP allocation %** for that goal. No separate “corpus allocation %” — it is the same as the SIP allocation % for that goal.

This keeps corpus and SIP in line: both use the same **optimal allocation %** per goal, which is the **SIP % by asset class** for that goal.

---

### 3.4 Aggregate SIP % per asset class (all goals)

Once per-goal SIP amounts and per-goal allocation % are final:

1. **Per goal**  
   - SIP amount = `allocatedSIP`  
   - Allocation = `assetAllocation[]` (e.g. 60% equity, 40% bond).  
   - So **SIP to asset class A for this goal** = `allocatedSIP * (percentage_A / 100)`.

2. **Totals per asset class**  
   Sum these amounts across all goals (basic + ambitious) for each asset class.

3. **SIP plan output**  
   In `buildSIPPlan()`:
   - **Per-goal allocations**: `goalId_tier`, `monthlyAmount`, `percentage` (of available SIP).  
   - **Per-asset-class allocations**: for each asset class, total SIP amount to that class; **percentage** = `(total_SIP_to_asset_class / availableSIP) * 100`. So the **overall SIP % per asset class** is the share of **total (stretch) SIP** going to that asset class across all goals.  
   - **Goal–asset breakdown**: each goal/tier still has its own `allocations[]` (asset class + percentage), which is exactly the **SIP % per asset class for that goal**.

---

## 4. Summary

| Concept | How it’s determined in GharFin |
|--------|-----------------------------------|
| **SIP % per asset class for a goal** | Same as the goal’s **optimal asset allocation %**: from `getOptimalAllocation()` (Sharpe-style optimization over allowed assets; for basic tier, time-based bond shift in last 12 months). Target is the goal’s **max** amount; confidence is **95%**. |
| **SIP amount per goal** | Required SIP from **Monte Carlo** (lognormal, volatility-based) to reach basic (then ambitious) **max** target at **95% confidence**; allocated in **priority order** within available SIP; then **corpus rebalanced** to match each goal’s allocation %; iterated until convergence. |
| **Overall SIP % per asset class** | Sum over goals of `(goal SIP amount × goal’s allocation % for that asset class)`, then divided by **available SIP** (base + stretch). |
| **Corpus by asset class per goal** | After rebalancing: same **allocation %** as the goal’s SIP allocation %; corpus amount per asset = goal’s corpus share × (percentage / 100). |

The request JSON supplies **assets** (with `volatility_range` for GharFin), **customer_profile** (corpus and allowed asset classes), **goals** (horizon, profile_type, tiers, priorities), and **monthlySIP** / **stretchSIPPercent** / **annualStepUpPercent**. The GharFin method uses these to compute the optimal allocation % per goal (hence SIP % per asset class per goal), then the SIP amounts and aggregate SIP % per asset class as above.

**API:** The primary endpoint for GharFin is `POST /api/plan/gharfin`. The response includes `method: "gharfin"`, the goal feasibility table (with 95% confidence on basic-tier max target), SIP allocation, and corpus allocation.
