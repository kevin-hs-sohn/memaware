/**
 * Condition: No memory — agent responds from general knowledge only.
 * Baseline that establishes the floor for memory-free responses.
 */

import { chatComplete, MODELS } from "../lib/llm.mjs";

export const name = "no-memory";
export const description = "No memory — agent responds from general knowledge only";

const SYSTEM = `You are a helpful AI assistant. Respond to the user's request.`;

/**
 * @param {Object} question - The benchmark question
 * @param {Object} context - Available memory context (unused)
 * @returns {Promise<{ response: string }>}
 */
export async function evaluate(question, context) {
  const response = await chatComplete(MODELS.ANSWER, SYSTEM, question.question, {
    maxTokens: 2048,
  });
  return { response };
}
