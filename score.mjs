#!/usr/bin/env node

/**
 * MemAware Scoring
 *
 * Reads JSONL result files and produces accuracy tables by difficulty tier.
 *
 * Usage:
 *   node score.mjs                       # Score all result files
 *   node score.mjs --condition bm25-search  # Score a single condition
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = process.env.MEMAWARE_RESULTS || join(__dirname, "results");

const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
};
const CONDITION_FILTER = getArg("condition");

// ─── Load results ───

const loadResults = (conditionName) => {
  const path = join(RESULTS_DIR, `raw-${conditionName}.jsonl`);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
};

/** Discover all condition names from result files. */
const discoverConditions = () => {
  if (!existsSync(RESULTS_DIR)) return [];
  return readdirSync(RESULTS_DIR)
    .filter((f) => f.startsWith("raw-") && f.endsWith(".jsonl"))
    .map((f) => f.replace(/^raw-/, "").replace(/\.jsonl$/, ""))
    .sort();
};

// ─── Compute stats ───

const computeStats = (records) => {
  const total = records.length;
  const correct = records.filter((r) => r.score === 1).length;
  const accuracy = total > 0 ? correct / total : 0;

  const byType = {};
  for (const r of records) {
    const rt = r.response_type || "unknown";
    byType[rt] = (byType[rt] || 0) + 1;
  }

  const tokens = records.map((r) => r.tokens_used || 0).filter((t) => t > 0);
  const medianTokens = tokens.length > 0
    ? tokens.sort((a, b) => a - b)[Math.floor(tokens.length / 2)]
    : 0;

  return { total, correct, accuracy, byType, medianTokens };
};

// ─── Format helpers ───

const pct = (n) => `${(n * 100).toFixed(1)}%`;
const tok = (n) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
const pad = (s, w) => s.padEnd(w);
const padL = (s, w) => s.padStart(w);

// ─── Print tables ───

const printAccuracyTable = (conditionResults) => {
  const difficulties = ["easy", "medium", "hard"];

  console.log("\n  === Accuracy ===\n");
  console.log(`  ${pad("Method", 24)} ${padL("Easy", 12)} ${padL("Medium", 12)} ${padL("Hard", 12)} ${padL("Overall", 12)}`);
  console.log(`  ${"-".repeat(72)}`);

  for (const [name, records] of conditionResults) {
    const overall = computeStats(records);
    const byDiff = {};
    for (const d of difficulties) {
      byDiff[d] = computeStats(records.filter((r) => r.difficulty === d));
    }

    const row = [
      pad(name, 24),
      padL(byDiff.easy.total > 0 ? `${pct(byDiff.easy.accuracy)} (n=${byDiff.easy.total})` : "—", 12),
      padL(byDiff.medium.total > 0 ? `${pct(byDiff.medium.accuracy)} (n=${byDiff.medium.total})` : "—", 12),
      padL(byDiff.hard.total > 0 ? `${pct(byDiff.hard.accuracy)} (n=${byDiff.hard.total})` : "—", 12),
      padL(`${pct(overall.accuracy)} (n=${overall.total})`, 12),
    ];
    console.log(`  ${row.join(" ")}`);
  }
};

const printTokenTable = (conditionResults) => {
  const difficulties = ["easy", "medium", "hard"];

  console.log("\n  === Token Efficiency (median tokens per question) ===\n");
  console.log(`  ${pad("Method", 24)} ${padL("Easy", 10)} ${padL("Medium", 10)} ${padL("Hard", 10)}`);
  console.log(`  ${"-".repeat(54)}`);

  for (const [name, records] of conditionResults) {
    const byDiff = {};
    for (const d of difficulties) {
      byDiff[d] = computeStats(records.filter((r) => r.difficulty === d));
    }

    const row = [
      pad(name, 24),
      padL(byDiff.easy.medianTokens > 0 ? tok(byDiff.easy.medianTokens) : "—", 10),
      padL(byDiff.medium.medianTokens > 0 ? tok(byDiff.medium.medianTokens) : "—", 10),
      padL(byDiff.hard.medianTokens > 0 ? tok(byDiff.hard.medianTokens) : "—", 10),
    ];
    console.log(`  ${row.join(" ")}`);
  }
};

const printResponseTypes = (conditionResults) => {
  console.log("\n  === Response Type Distribution ===\n");

  for (const [name, records] of conditionResults) {
    const stats = computeStats(records);
    const types = Object.entries(stats.byType)
      .sort(([, a], [, b]) => b - a)
      .map(([type, count]) => `${type}: ${count} (${pct(count / stats.total)})`)
      .join(", ");
    console.log(`  ${pad(name, 24)} ${types}`);
  }
};

// ─── Save summary ───

const saveSummary = (conditionResults) => {
  const summary = {};
  for (const [name, records] of conditionResults) {
    const overall = computeStats(records);
    const byDiff = {};
    for (const d of ["easy", "medium", "hard"]) {
      byDiff[d] = computeStats(records.filter((r) => r.difficulty === d));
    }
    summary[name] = {
      overall: { accuracy: overall.accuracy, total: overall.total, correct: overall.correct },
      easy: { accuracy: byDiff.easy.accuracy, total: byDiff.easy.total },
      medium: { accuracy: byDiff.medium.accuracy, total: byDiff.medium.total },
      hard: { accuracy: byDiff.hard.accuracy, total: byDiff.hard.total },
      medianTokens: overall.medianTokens,
      responseTypes: overall.byType,
    };
  }

  const outPath = join(RESULTS_DIR, "baselines.json");
  writeFileSync(outPath, JSON.stringify(summary, null, 2) + "\n");
  console.log(`\n  + Summary saved to ${outPath}`);
};

// ─── Main ───

const conditions = CONDITION_FILTER ? [CONDITION_FILTER] : discoverConditions();

if (conditions.length === 0) {
  console.log("  ! No result files found. Run `node run.mjs` first.");
  process.exit(1);
}

const conditionResults = [];
for (const name of conditions) {
  const records = loadResults(name);
  if (records.length > 0) {
    conditionResults.push([name, records]);
    console.log(`  + ${name}: ${records.length} results`);
  } else {
    console.log(`  ~ ${name}: no results`);
  }
}

if (conditionResults.length === 0) {
  console.log("  ! No results to score.");
  process.exit(1);
}

printAccuracyTable(conditionResults);
printTokenTable(conditionResults);
printResponseTypes(conditionResults);
saveSummary(conditionResults);
