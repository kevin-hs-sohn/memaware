#!/usr/bin/env node

/**
 * MemAware Benchmark Runner
 *
 * Usage:
 *   node run.mjs --condition no-memory
 *   node run.mjs --condition bm25-search
 *   node run.mjs --condition bm25-vector-search
 *   node run.mjs --condition all
 *   node run.mjs --condition my-system --limit 50 --concurrency 10
 */

import { existsSync, readFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chatComplete, MODELS, setConcurrency, resetUsage, getUsage, printUsage } from "./lib/llm.mjs";
import { buildIndex, search } from "./lib/bm25.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const QUESTIONS_PATH = process.env.MEMAWARE_QUESTIONS || join(__dirname, "data", "questions.json");
const MEMORY_DIR = process.env.MEMAWARE_MEMORY || join(__dirname, "data", "compacted");
const RESULTS_DIR = process.env.MEMAWARE_RESULTS || join(__dirname, "results");

// ─── CLI args ───

const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
};

const LIMIT = getArg("limit") ? parseInt(getArg("limit")) : Infinity;
const CONDITION_NAME = getArg("condition") || "no-memory";
const CONCURRENCY = getArg("concurrency") ? parseInt(getArg("concurrency")) : 20;
setConcurrency(CONCURRENCY);

// ─── Baseline conditions ───

const BASELINE_CONDITIONS = ["no-memory", "bm25-search", "bm25-vector-search"];

// ─── Load questions ───

if (!existsSync(QUESTIONS_PATH)) {
  console.error(`  ! Questions file not found: ${QUESTIONS_PATH}`);
  console.error("  ! Download the dataset or set MEMAWARE_QUESTIONS env var");
  process.exit(1);
}

const questions = JSON.parse(readFileSync(QUESTIONS_PATH, "utf8"));
console.log(`  + Loaded ${questions.length} questions`);

// ─── Load memory mapping ───

const MAPPING_PATH = join(MEMORY_DIR, "_mapping.json");
let fileMap = null;

const loadFileMap = () => {
  if (fileMap) return fileMap;
  if (existsSync(MAPPING_PATH)) {
    fileMap = new Map(Object.entries(JSON.parse(readFileSync(MAPPING_PATH, "utf8"))));
  } else {
    fileMap = new Map();
  }
  return fileMap;
};

// ─── Build shared BM25 index (lazy, cached) ───

let sharedBm25Index = null;

const getSharedSearch = () => {
  if (!sharedBm25Index) {
    const map = loadFileMap();
    const docs = [];
    for (const [filePath] of map) {
      const fullPath = filePath.startsWith("/") ? filePath : join(MEMORY_DIR, filePath);
      if (existsSync(fullPath)) {
        docs.push({ id: fullPath, text: readFileSync(fullPath, "utf8") });
      }
    }
    if (docs.length > 0) {
      sharedBm25Index = buildIndex(docs);
    }
  }
  return (query, k = 10) => {
    if (!sharedBm25Index) return [];
    return search(sharedBm25Index, query, k);
  };
};

// ─── Judge ───

const JUDGE_PROMPT = `An AI assistant was asked to perform a task. A related past decision exists in the assistant's memory that should have been surfaced proactively.

Task request: {question}
Past context that should have been recalled: {should_recall}
Why these are related: {connection}

Assistant's response:
{response}

Did the assistant demonstrate awareness of the related past context? This means the assistant either explicitly referenced the past decision, used information from it, or acknowledged its relevance. Simply arriving at the same answer by coincidence does NOT count.

Also classify the response type:
- CORRECT: explicitly referenced the right past context
- ABSTAINED: responded without any reference to past context
- HALLUCINATED: referenced past context that is wrong or doesn't exist
- PARTIAL: referenced related but different past context

Answer format: YES/NO | TYPE
Example: YES | CORRECT or NO | ABSTAINED`;

/**
 * Judge a response for implicit context awareness.
 * @param {Object} question - The question object
 * @param {string} response - The model's response
 * @returns {Promise<{ score: number, responseType: string }>}
 */
const judgeResponse = async (question, response) => {
  const prompt = JUDGE_PROMPT
    .replace("{question}", question.question)
    .replace("{should_recall}", question.should_recall || "")
    .replace("{connection}", question.connection || "")
    .replace("{response}", response);

  const result = await chatComplete(MODELS.JUDGE, "You are an evaluation judge.", prompt, {
    maxTokens: 20,
  });

  const parts = result.trim().split("|").map(s => s.trim());
  const score = parts[0].toLowerCase().startsWith("yes") ? 1 : 0;
  const responseType = parts[1]?.toLowerCase() || "unknown";

  return { score, responseType };
};

// ─── Run a single condition ───

const runCondition = async (conditionName) => {
  console.log(`\n  === ${conditionName} ===\n`);

  // Load condition module
  const mod = await import(`./conditions/${conditionName}.mjs`);
  const evaluate = mod.evaluate;

  mkdirSync(RESULTS_DIR, { recursive: true });
  const resultsPath = join(RESULTS_DIR, `raw-${conditionName}.jsonl`);

  // Resume support: skip already-completed questions
  const completed = new Set();
  if (existsSync(resultsPath)) {
    for (const line of readFileSync(resultsPath, "utf8").trim().split("\n").filter(Boolean)) {
      try { completed.add(JSON.parse(line).question_id); } catch { /* skip malformed lines */ }
    }
    console.log(`  ~ Resuming: ${completed.size} already done`);
  }

  // Build context object shared across all questions
  const context = {
    memoryDir: MEMORY_DIR,
    fileMap: loadFileMap(),
    search: getSharedSearch(),
  };

  resetUsage();
  let processed = 0;

  for (const question of questions) {
    if (processed >= LIMIT) break;
    if (completed.has(question.question_id)) { processed++; continue; }

    const tierLabel = question.difficulty ? ` [${question.difficulty}]` : "";
    console.log(`  ~ [${processed + 1}/${Math.min(questions.length, LIMIT)}] ${question.question_id} (${question.type}${tierLabel})`);

    try {
      // Track tokens for the evaluate call (excludes judge)
      const startUsage = getUsage();
      const result = await evaluate(question, context);
      const endUsage = getUsage();
      const tokensUsed = (endUsage.inputTokens - startUsage.inputTokens)
        + (endUsage.outputTokens - startUsage.outputTokens);

      // Judge the response
      const { score, responseType } = await judgeResponse(question, result.response);

      const record = {
        question_id: question.question_id,
        type: question.type,
        difficulty: question.difficulty,
        condition: conditionName,
        response: result.response,
        score,
        response_type: responseType,
        tokens_used: tokensUsed,
        should_recall: question.should_recall,
        connection: question.connection,
      };

      appendFileSync(resultsPath, JSON.stringify(record) + "\n");

      const icon = score === 1 ? "\u2713" : "\u2717";
      const rtLabel = responseType ? ` (${responseType})` : "";
      console.log(`    ${icon}${rtLabel} | ${tokensUsed} tokens`);

      processed++;
      if (processed % 20 === 0) printUsage();

    } catch (err) {
      console.error(`  ! Error on ${question.question_id}: ${err.message}`);
      appendFileSync(resultsPath, JSON.stringify({
        question_id: question.question_id,
        type: question.type,
        difficulty: question.difficulty,
        condition: conditionName,
        score: 0,
        response_type: "error",
        tokens_used: 0,
      }) + "\n");
      processed++;
    }
  }

  printUsage();
  console.log(`  + Done: ${processed} questions evaluated\n`);
};

// ─── Main ───

if (CONDITION_NAME === "all") {
  for (const c of BASELINE_CONDITIONS) {
    await runCondition(c);
  }
} else {
  await runCondition(CONDITION_NAME);
}
