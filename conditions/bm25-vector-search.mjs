/**
 * Condition: BM25 + vector hybrid search via qmd.
 * Uses the qmd CLI for BM25 + vector + LLM rerank search.
 * Requires qmd installed and a pre-embedded collection.
 */

import { execSync } from "node:child_process";
import { chatComplete, MODELS } from "../lib/llm.mjs";

export const name = "bm25-vector-search";
export const description = "BM25 + vector hybrid search via qmd (requires qmd installed + embedded)";

const SYSTEM = `You are a helpful AI assistant with access to past conversation memory. You searched your memory and found the following results. Use relevant results to inform your response. If the results are not relevant, respond based on your general knowledge.`;

/**
 * @param {Object} question - The benchmark question
 * @param {Object} context - Available memory context
 * @param {string} context.memoryDir - Path to compacted memory files
 * @returns {Promise<{ response: string }>}
 */
export async function evaluate(question, context) {
  let searchContext = "(no results)";

  try {
    const query = question.question.replace(/"/g, '\\"').slice(0, 200);
    const result = execSync(`qmd query "${query}" --limit 5`, {
      cwd: context.memoryDir,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 30000,
    }).toString();
    if (result.trim()) searchContext = result.trim();
  } catch {
    // qmd not available or query failed — fall back to empty results
  }

  const prompt = `Memory search results:\n${searchContext}\n\nUser request: ${question.question}`;
  const response = await chatComplete(MODELS.ANSWER, SYSTEM, prompt, { maxTokens: 2048 });

  return { response };
}
