/**
 * Example condition template.
 * Copy this file and implement the evaluate() function for your memory system.
 */

/**
 * @param {Object} question - The benchmark question
 * @param {string} question.question - The user request text
 * @param {string} question.type - "direct_query" or "implicit_context"
 * @param {string} [question.difficulty] - "easy" | "medium" | "hard" (implicit only)
 * @param {string} [question.should_recall] - Expected past context (implicit only)
 * @param {string} [question.connection] - Why it's related (implicit only)
 * @param {Object} context - Available memory context
 * @param {string} context.rootMd - Compacted ROOT.md content (~3K tokens)
 * @param {string} context.memoryDir - Path to compacted memory directory
 * @param {Function} context.search - BM25 search function: (query, k) => results[]
 * @returns {Promise<{ response: string, tokensUsed: number }>}
 */
export async function evaluate(question, context) {
  // Example: simple RAG approach
  // const results = context.search(question.question, 5);
  // const response = await callLLM(question.question, results);
  // return { response, tokensUsed: countTokens(...) };

  throw new Error("Not implemented — copy this file and add your logic");
}

export const name = "example-custom";
export const description = "Template for adding a custom memory system";
