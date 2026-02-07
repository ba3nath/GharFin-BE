import * as fs from "fs";
import * as path from "path";
import { classifyScenarioBucket, BucketKey, ScenarioRunResultLike } from "./src/testScenarios/planningBucketClassifier";

interface BucketMeta {
  label: string; // human label (matches user numbering)
  title: string;
}

const BUCKET_META: Record<BucketKey, BucketMeta> = {
  bucket_7_sip_not_needed_corpus_only: {
    label: "7",
    title: "SIP is not needed; goal can be met with the corpus alone",
  },
  bucket_4_skewed_can_meet_method1_or_2: {
    label: "4",
    title: "Corpus is skewed; goal can be met with the SIP (method 1 or 2)",
  },
  bucket_5_skewed_can_meet_only_method3: {
    label: "5",
    title: "Corpus is skewed; goal can be met with rebalancing (only in method 3)",
  },
  bucket_3_skewed_cannot_meet_with_sip: {
    label: "3",
    title: "Corpus is skewed; goal cannot be met with the SIP",
  },
  bucket_6_balanced_cannot_meet_with_sip: {
    label: "6",
    title: "Corpus is balanced; goal cannot be met with the SIP",
  },
  bucket_1_2_corpus_or_sip_too_low_cannot_meet: {
    label: "1/2",
    title: "Corpus/SIP is low; goal cannot be met (combined buckets 1 and 2)",
  },
};

function readJson<T>(filePath: string): T {
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

function writeFileEnsuringDir(filePath: string, content: string) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
}

function renderMarkdown(summaries: ScenarioBucketSummary[], countsByBucket: Record<BucketKey, number>) {
  const lines: string[] = [];
  lines.push("## Planning scenarios – Bucket summary");
  lines.push("");
  lines.push("Buckets follow your definitions (basic-tier only). Note: buckets (1) and (2) are treated as the same combined bucket (1/2).");
  lines.push("");

  const orderedBuckets: BucketKey[] = [
    "bucket_7_sip_not_needed_corpus_only",
    "bucket_4_skewed_can_meet_method1_or_2",
    "bucket_5_skewed_can_meet_only_method3",
    "bucket_3_skewed_cannot_meet_with_sip",
    "bucket_6_balanced_cannot_meet_with_sip",
    "bucket_1_2_corpus_or_sip_too_low_cannot_meet",
  ];

  for (const bucket of orderedBuckets) {
    const meta = BUCKET_META[bucket];
    const bucketSummaries = summaries.filter((s) => s.bucket === bucket);
    lines.push(`### Bucket ${meta.label}: ${meta.title}`);
    lines.push("");
    lines.push(`Count: **${countsByBucket[bucket] ?? 0}**`);
    lines.push("");
    if (bucketSummaries.length === 0) {
      lines.push("_No scenarios currently classified into this bucket._");
      lines.push("");
      continue;
    }

    for (const s of bucketSummaries) {
      const review = s.needsReview ? " (needs-review)" : "";
      lines.push(`- **${s.scenario.name}** (\`${s.scenario.id}\`)${review}`);
      lines.push(`  - corpus: \`${s.debug.corpusProfile}\`, sip: \`${s.debug.sipProfile}\`, sipIsZero: \`${s.debug.sipIsZero}\``);
      lines.push(
        `  - all_basic_met: method1=\`${s.debug.m1_all_basic_met}\`, method2=\`${s.debug.m2_all_basic_met}\`, method3=\`${s.debug.m3_all_basic_met}\``
      );
      lines.push(`  - summary: ${s.summarySentence}`);
    }
    lines.push("");
  }

  const needsReview = summaries.filter((s) => s.needsReview);
  if (needsReview.length > 0) {
    lines.push("### Needs-review");
    lines.push("");
    lines.push(
      "These scenarios were successful but don’t map cleanly to your provided bucket list, so they were placed in bucket 7 as a fallback."
    );
    lines.push("");
    for (const s of needsReview) {
      lines.push(`- **${s.scenario.name}** (\`${s.scenario.id}\`)`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

interface ScenarioBucketSummary {
  scenario: { id: string; name: string };
  bucket: BucketKey;
  bucketLabel: string;
  bucketTitle: string;
  needsReview: boolean;
  debug: {
    corpusProfile: string;
    sipProfile: string;
    sipIsZero: boolean;
    m1_all_basic_met: boolean;
    m2_all_basic_met: boolean;
    m3_all_basic_met: boolean;
  };
  summarySentence: string;
}

function makeSummarySentence(s: ScenarioBucketSummary): string {
  switch (s.bucket) {
    case "bucket_7_sip_not_needed_corpus_only":
      return "Bucket 7: At least one method meets all basic goals with little/no SIP dependence (corpus-only for basic tiers).";
    case "bucket_4_skewed_can_meet_method1_or_2":
      return "Bucket 4: Skewed corpus; method 1 and/or method 2 meets all basic goals with the given SIP.";
    case "bucket_5_skewed_can_meet_only_method3":
      return "Bucket 5: Skewed corpus; methods 1/2 fail but method 3 meets all basic goals via rebalancing.";
    case "bucket_3_skewed_cannot_meet_with_sip":
      return "Bucket 3: Skewed corpus; all methods fail to meet all basic goals with the given SIP.";
    case "bucket_6_balanced_cannot_meet_with_sip":
      return "Bucket 6: Balanced corpus; all methods fail to meet all basic goals with the given SIP.";
    case "bucket_1_2_corpus_or_sip_too_low_cannot_meet":
      return "Bucket 1/2: Corpus/SIP too low (combined); all methods fail to meet all basic goals.";
    default: {
      const _exhaustive: never = s.bucket;
      return String(_exhaustive);
    }
  }
}

function main() {
  const docsDir = path.resolve("docs");
  const inputPath = path.join(docsDir, "planning-test-scenarios-output.json");
  const runs = readJson<ScenarioRunResultLike[]>(inputPath);

  const summaries: ScenarioBucketSummary[] = runs.map((run) => {
    const classification = classifyScenarioBucket(run);
    const meta = BUCKET_META[classification.bucket];
    const base: ScenarioBucketSummary = {
      scenario: { id: run.scenario.id, name: run.scenario.name },
      bucket: classification.bucket,
      bucketLabel: meta.label,
      bucketTitle: meta.title,
      needsReview: classification.needsReview,
      debug: { ...classification.debug },
      summarySentence: "",
    };
    base.summarySentence = makeSummarySentence(base);
    return base;
  });

  const countsByBucket = summaries.reduce((acc, s) => {
    acc[s.bucket] = (acc[s.bucket] ?? 0) + 1;
    return acc;
  }, {} as Record<BucketKey, number>);

  // Emit JSON and markdown
  const jsonOutPath = path.join(docsDir, "planning-bucket-summary.json");
  const mdOutPath = path.join(docsDir, "planning-bucket-summary.md");

  writeFileEnsuringDir(jsonOutPath, JSON.stringify({ generatedAt: new Date().toISOString(), countsByBucket, summaries }, null, 2));
  writeFileEnsuringDir(mdOutPath, renderMarkdown(summaries, countsByBucket));

  // Console summary (useful when running manually)
  const ordered: BucketKey[] = [
    "bucket_7_sip_not_needed_corpus_only",
    "bucket_4_skewed_can_meet_method1_or_2",
    "bucket_5_skewed_can_meet_only_method3",
    "bucket_3_skewed_cannot_meet_with_sip",
    "bucket_6_balanced_cannot_meet_with_sip",
    "bucket_1_2_corpus_or_sip_too_low_cannot_meet",
  ];

  console.log("Bucket coverage:");
  for (const b of ordered) {
    const meta = BUCKET_META[b];
    console.log(`- Bucket ${meta.label}: ${countsByBucket[b] ?? 0}`);
  }

  const needsReview = summaries.filter((s) => s.needsReview);
  if (needsReview.length > 0) {
    console.log("");
    console.log(`Needs-review scenarios (fallback bucket 7): ${needsReview.length}`);
    for (const s of needsReview) console.log(`- ${s.scenario.id}`);
  }

  console.log("");
  console.log(`Wrote JSON summary to ${jsonOutPath}`);
  console.log(`Wrote markdown summary to ${mdOutPath}`);
}

main();

