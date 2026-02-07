import * as fs from "fs";
import * as path from "path";
import { GoalPlanner } from "./src/planner/goalPlanner";
import { planningTestScenarios } from "./src/testScenarios/planningTestScenarios";
import { PlanningResult } from "./src/models/PlanningResult";
import { PlanningTestScenario } from "./src/models/TestScenario";

interface MethodResultsBundle {
  method1: PlanningResult;
  method2: PlanningResult;
  method3: PlanningResult;
}

interface ScenarioRunResult {
  scenario: PlanningTestScenario;
  results: MethodResultsBundle;
}

/**
 * Run all planning test scenarios through Method 1, 2, and 3, and generate:
 * - A JSON dump of raw inputs/outputs for debugging.
 * - A markdown report under docs/.
 *
 * Usage:
 *   npx ts-node run-planning-test-scenarios.ts
 */

function runScenario(scenario: PlanningTestScenario): MethodResultsBundle {
  const { assetClasses, customerProfile, goals, sipInput } = scenario;

  const planner = new GoalPlanner({
    assetClasses,
    customerProfile,
    goals: goals.goals,
    sipInput,
  });

  const method1 = planner.planMethod1();
  const method2 = planner.planMethod2();
  const method3 = planner.planMethod3();

  return { method1, method2, method3 };
}

function formatMoney(value: number): string {
  const rounded = Math.round(value);
  return `₹${rounded.toLocaleString("en-IN")}`;
}

function renderScenarioMarkdown(run: ScenarioRunResult): string {
  const { scenario, results } = run;
  const { classification, description, customerProfile, goals, sipInput, meta } = scenario;

  const headerLines = [
    `### Scenario: ${scenario.name} (_${scenario.id}_)`,
    "",
    `**Classification**:`,
    `- Corpus: \`${classification.corpusProfile}\``,
    `- SIP: \`${classification.sipProfile}\``,
    `- Goals: \`${classification.goalProfile}\``,
    `- Timelines: \`${classification.timelineProfile}\``,
    "",
    `**Intent**: ${description}`,
  ];

  const metaLines: string[] = [];
  if (meta) {
    metaLines.push("");
    metaLines.push("**Design intent**:");
    metaLines.push(
      `- Designed reachable (basic tiers): \`${meta.designedReachableBasic ? "yes" : "no"}\``
    );
    if (meta.notes) {
      metaLines.push(`- Notes: ${meta.notes}`);
    }
    if (meta.edgeTags && meta.edgeTags.length > 0) {
      metaLines.push(`- Edge tags: \`${meta.edgeTags.join(", ")}\``);
    }
    if (meta.edgeSummary) {
      metaLines.push(`- Edge summary: ${meta.edgeSummary}`);
    }
  }

  const corpusTotal = Object.values(customerProfile.corpus.byAssetClass).reduce(
    (sum, v) => sum + v,
    0
  );

  const corpusLines = [
    "",
    "**Corpus**:",
    "",
    `- As-of date: \`${customerProfile.asOfDate}\``,
    `- Total net worth (corpus sum): ${formatMoney(corpusTotal)}`,
    "",
    "| Asset class | Amount |",
    "|------------|--------|",
    ...Object.entries(customerProfile.corpus.byAssetClass).map(
      ([asset, amount]) => `| \`${asset}\` | ${formatMoney(amount)} |`
    ),
  ];

  const sipLines = [
    "",
    "**SIP Input**:",
    "",
    `- Monthly SIP: ${formatMoney(sipInput.monthlySIP)}`,
    `- Stretch SIP %: ${sipInput.stretchSIPPercent}%`,
    `- Annual step-up %: ${sipInput.annualStepUpPercent}%`,
  ];

  const goalsLines = [
    "",
    "**Goals**:",
    "",
    "| Goal | Horizon (years) | Tier | Target | Priority |",
    "|------|-----------------|------|--------|----------|",
    ...goals.goals.flatMap((g) => {
      return [
        `| ${g.goalName} | ${g.horizonYears} | basic | ${formatMoney(
          g.tiers.basic.targetAmount
        )} | ${g.tiers.basic.priority} |`,
        `| ${g.goalName} | ${g.horizonYears} | ambitious | ${formatMoney(
          g.tiers.ambitious.targetAmount
        )} | ${g.tiers.ambitious.priority} |`,
      ];
    }),
  ];

  const goalIdToName = new Map(goals.goals.map((g) => [g.goalId, g.goalName]));

  function formatSIPAllocation(result: PlanningResult): string[] {
    const { sipAllocation } = result;
    const total = sipAllocation.totalMonthlySIP;
    if (total <= 0 || sipAllocation.perGoalAllocations.length === 0) {
      return ["_No SIP allocated (or zero total)._"];
    }
    const goalAssetMap = new Map(
      (sipAllocation.goalAssetAllocations ?? []).map((g) => [g.goalId, g.allocations])
    );
    const header = [
      "",
      "| Goal | Tier | Monthly amount | % of total SIP | Asset allocation |",
      "|------|------|----------------|----------------|------------------|",
    ];
    const rows = sipAllocation.perGoalAllocations.map((a) => {
      const idx = a.goalId.lastIndexOf("_");
      const goalId = idx >= 0 ? a.goalId.slice(0, idx) : a.goalId;
      const tier = idx >= 0 ? a.goalId.slice(idx + 1) : "basic";
      const goalName = goalIdToName.get(goalId) ?? goalId;
      const assetAlloc = goalAssetMap.get(a.goalId);
      const assetStr =
        assetAlloc && assetAlloc.length > 0
          ? assetAlloc
              .filter((x) => x.assetClass !== "cash" && x.percentage > 0)
              .map((x) => `${x.assetClass} ${x.percentage}%`)
              .join(", ") || "—"
          : "—";
      return `| ${goalName} | ${tier} | ${formatMoney(a.monthlyAmount)} | ${a.percentage}% | ${assetStr} |`;
    });
    return [...header, ...rows];
  }

  function formatMethod3CorpusAdjustment(): string[] {
    const m3 = results.method3 as PlanningResult & { corpusAllocation: Record<string, Record<string, number>> };
    const initial = customerProfile.corpus.byAssetClass;
    const alloc = m3.corpusAllocation ?? {};

    const initialTotal = Object.values(initial).reduce((s, v) => s + v, 0);
    const lines: string[] = [
      "",
      "**Initial corpus (customer)** – by asset class:",
      "",
      "| Asset class | Amount |",
      "|------------|--------|",
      ...Object.entries(initial).map(([ac, amt]) => `| \`${ac}\` | ${formatMoney(amt)} |`),
      "",
      `Total: ${formatMoney(initialTotal)}`,
      "",
      "**Method 3 recommended allocation** – by goal:",
      "",
    ];

    const assetClasses = [...new Set([...Object.keys(initial), ...Object.values(alloc).flatMap((g) => Object.keys(g))])];
    const headerRow = ["Goal", ...assetClasses, "Total"].join(" | ");
    const sepRow = ["------", ...assetClasses.map(() => "--------"), "--------"].join(" | ");
    lines.push(`| ${headerRow} |`);
    lines.push(`| ${sepRow} |`);

    for (const g of goals.goals) {
      const goalAlloc = alloc[g.goalId] ?? {};
      const byAc = assetClasses.map((ac) => formatMoney(goalAlloc[ac] ?? 0));
      const total = Object.values(goalAlloc).reduce((s, v) => s + v, 0);
      lines.push(`| ${g.goalName} | ${byAc.join(" | ")} | ${formatMoney(total)} |`);
    }

    const m3Total = Object.values(alloc).reduce(
      (sum, g) => sum + Object.values(g).reduce((s, v) => s + v, 0),
      0
    );
    lines.push("");
    lines.push(`Method 3 total (should match initial): ${formatMoney(m3Total)}`);
    return lines;
  }

  function summarizeMethod(name: "method1" | "method2" | "method3", label: string) {
    const result = results[name] as PlanningResult;
    const rows = result.goalFeasibilityTable.rows;

    const tableLines = [
      "",
      `#### ${label} (${name})`,
      "",
      "| Goal | Tier | Status | Confidence % | Target | Mean corpus | Mean - Target |",
      "|------|------|--------|--------------|--------|-------------|---------------|",
      ...rows.map((row) => {
        const meanDeviation = row.projectedCorpus.meanDeviation ?? 0;
        return [
          row.goalName,
          row.tier,
          row.status,
          `${row.confidencePercent}`,
          formatMoney(row.targetAmount),
          formatMoney(row.projectedCorpus.mean),
          formatMoney(meanDeviation),
        ].reduce(
          (line, cell, idx) => (idx === 0 ? `| ${cell}` : `${line} | ${cell}`),
          ""
        ) + " |";
      }),
    ];

    const sipLines = ["", "**SIP allocation %**:", ...formatSIPAllocation(result)];

    const method3Extra = name === "method3" ? ["", "**Corpus allocation adjustment**:", ...formatMethod3CorpusAdjustment()] : [];

    return [...tableLines, ...sipLines, ...method3Extra];
  }

  const comparisonHeader = [
    "",
    "**Method comparison (per-goal feasibility)**:",
    "",
  ];

  const lines = [
    ...headerLines,
    ...metaLines,
    ...corpusLines,
    ...sipLines,
    ...goalsLines,
    ...comparisonHeader,
    ...summarizeMethod("method1", "Method 1 – Envelope / current corpus"),
    ...summarizeMethod("method2", "Method 2 – Monte Carlo / rebalanced corpus"),
    ...summarizeMethod("method3", "Method 3 – Monte Carlo / iterative from zero corpus"),
    "",
  ];

  return lines.join("\n");
}

function renderIndexMarkdown(runs: ScenarioRunResult[]): string {
  const lines: string[] = [];

  lines.push("## Planning Methods – Scenario Report");
  lines.push("");
  lines.push(
    "This report summarises a curated grid of test scenarios across corpus/SIP/goals/timelines, run through all three planning methods."
  );
  lines.push("");
  lines.push("### Status and confidence");
  lines.push("");
  lines.push("**Status meanings**");
  lines.push("- **can_be_met**: The goal is expected to be achieved with high confidence (typically ≥90%).");
  lines.push("- **at_risk**: Some chance of shortfall; confidence is between 50% and 90%.");
  lines.push("- **cannot_be_met**: Low confidence (<50%) that the target will be reached.");
  lines.push("");
  lines.push("**Confidence types**");
  lines.push("- **Portfolio-level confidence**: Uses a Monte Carlo simulation of the full multi-goal portfolio. At each goal’s due date, we check whether total portfolio value (after prior withdrawals) meets the goal target. Confidence is the % of simulated paths where the target is met.");
  lines.push("- **Goal-level confidence**: Uses a single-goal simulation (corpus + SIP for that goal only). More direct but ignores interactions with other goals (e.g. earlier withdrawals).");
  lines.push("");
  lines.push("This report uses portfolio-level confidence for status and confidence % where multiple goals exist.");
  lines.push("");
  const baselineRuns = runs.filter((r) => r.scenario.kind === "baseline");
  const edgeCaseRuns = runs.filter((r) => r.scenario.kind === "edge_case");

  // Baseline scenarios table
  if (baselineRuns.length > 0) {
    lines.push("### Baseline scenarios");
    lines.push("");
    lines.push("| Scenario | Corpus | SIP | Goals | Timelines | Designed reachable (basic) |");
    lines.push("|----------|--------|-----|-------|-----------|-----------------------------|");

    for (const run of baselineRuns) {
      const { scenario } = run;
      const c = scenario.classification;
      const reachable = scenario.meta?.designedReachableBasic ? "yes" : "no";
      lines.push(
        `| [${scenario.name}](#scenario-${scenario.id.toLowerCase()}) | \`${c.corpusProfile}\` | \`${c.sipProfile}\` | \`${c.goalProfile}\` | \`${c.timelineProfile}\` | \`${reachable}\` |`
      );
    }

    lines.push("");
  }

  // Edge-case scenarios table
  if (edgeCaseRuns.length > 0) {
    lines.push("### Edge-case scenarios");
    lines.push("");
    lines.push(
      "| Scenario | Corpus | SIP | Goals | Timelines | Edge tags | Designed reachable (basic) |"
    );
    lines.push(
      "|----------|--------|-----|-------|-----------|-----------|-----------------------------|"
    );

    for (const run of edgeCaseRuns) {
      const { scenario } = run;
      const c = scenario.classification;
      const reachable = scenario.meta?.designedReachableBasic ? "yes" : "no";
      const edgeTags = scenario.meta?.edgeTags?.join(", ") ?? "";
      lines.push(
        `| [${scenario.name}](#scenario-${scenario.id.toLowerCase()}) | \`${c.corpusProfile}\` | \`${c.sipProfile}\` | \`${c.goalProfile}\` | \`${c.timelineProfile}\` | \`${edgeTags}\` | \`${reachable}\` |`
      );
    }

    lines.push("");
  }

  for (const run of runs) {
    lines.push(
      `---`,
      "",
      `<a id="scenario-${run.scenario.id.toLowerCase()}"></a>`,
      ""
    );
    lines.push(renderScenarioMarkdown(run));
  }

  return lines.join("\n");
}

function main() {
  const runs: ScenarioRunResult[] = planningTestScenarios.map((scenario) => ({
    scenario,
    results: runScenario(scenario),
  }));

  const outDir = path.resolve("docs");
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  // Raw JSON dump for debugging / further tooling
  const jsonOutPath = path.join(outDir, "planning-test-scenarios-output.json");
  fs.writeFileSync(jsonOutPath, JSON.stringify(runs, null, 2));

  // Human-readable markdown report
  const mdOutPath = path.join(outDir, "planning-test-report.md");
  fs.writeFileSync(mdOutPath, renderIndexMarkdown(runs), "utf-8");

  console.log(`Wrote JSON output to ${jsonOutPath}`);
  console.log(`Wrote markdown report to ${mdOutPath}`);
}

main();

