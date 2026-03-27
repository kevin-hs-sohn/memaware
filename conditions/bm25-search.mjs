/**
 * Condition: BM25 keyword search on every request.
 * Standard RAG pattern — always search before responding.
 * Represents systems like Mem0, MemGPT, ChatGPT memory.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { chatComplete, MODELS } from "../lib/llm.mjs";
import { buildIndex, search } from "../lib/bm25.mjs";

export const name = "bm25-search";
export const description = "BM25 keyword search on every request (standard RAG pattern)";

const SYSTEM = `You are a helpful AI assistant with access to past conversation memory. You have searched your memory and found the following results. Use relevant results to inform your response. If the results are not relevant, respond based on your general knowledge.`;

/**
 * @param {Object} question - The benchmark question
 * @param {Object} context - Available memory context
 * @param {string} context.memoryDir - Path to compacted memory files
 * @param {Map} context.fileMap - Mapping from file paths to session IDs
 * @returns {Promise<{ response: string }>}
 */
export async function evaluate(question, context) {
  // Build BM25 index over raw session files
  const docs = [];
  for (const [filePath] of context.fileMap) {
    const fullPath = filePath.startsWith("/") ? filePath : join(context.memoryDir, filePath);
    if (existsSync(fullPath)) {
      docs.push({ id: fullPath, text: readFileSync(fullPath, "utf8") });
    }
  }

  let searchContext = "(no memory files found)";
  if (docs.length > 0) {
    const idx = buildIndex(docs);
    const results = search(idx, question.question, 5);

    const parts = [];
    for (const r of results) {
      const content = readFileSync(r.id, "utf8");
      const filename = r.id.split("/").pop();
      parts.push(`--- ${filename} (relevance: ${r.score.toFixed(2)}) ---\n${content.slice(0, 3000)}`);
    }
    searchContext = parts.join("\n\n");
  }

  const prompt = `Memory search results:\n${searchContext}\n\nUser request: ${question.question}`;
  const response = await chatComplete(MODELS.ANSWER, SYSTEM, prompt, { maxTokens: 2048 });

  return { response };
}
