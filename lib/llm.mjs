/**
 * Multi-provider LLM wrapper (OpenAI + Fireworks).
 * Routes by model name: "accounts/fireworks/*" -> Fireworks, else -> OpenAI.
 * Includes concurrency control (semaphore), retry, and usage tracking.
 */

import OpenAI from "openai";

// ─── Clients ───

let openaiClient;
let fireworksClient;

const getOpenAIClient = () => {
  if (!openaiClient) {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY required");
    openaiClient = new OpenAI();
  }
  return openaiClient;
};

const getFireworksClient = () => {
  if (!fireworksClient) {
    if (!process.env.FIREWORKS_API_KEY) throw new Error("FIREWORKS_API_KEY required");
    fireworksClient = new OpenAI({
      apiKey: process.env.FIREWORKS_API_KEY,
      baseURL: "https://api.fireworks.ai/inference/v1",
    });
  }
  return fireworksClient;
};

const getClientForModel = (model) =>
  model.startsWith("accounts/fireworks/") ? getFireworksClient() : getOpenAIClient();

// ─── Concurrency ───

let concurrency = 5;
let activeRequests = 0;
const waitQueue = [];

/** Set max concurrent LLM requests. */
export const setConcurrency = (n) => { concurrency = n; };

const acquire = () => new Promise((resolve) => {
  if (activeRequests < concurrency) { activeRequests++; resolve(); }
  else waitQueue.push(resolve);
});

const release = () => {
  activeRequests--;
  if (waitQueue.length > 0) { activeRequests++; waitQueue.shift()(); }
};

// ─── Usage tracking ───

const usage = { inputTokens: 0, outputTokens: 0, calls: 0 };

/** Get current usage stats. */
export const getUsage = () => ({ ...usage });

/** Reset usage counters. */
export const resetUsage = () => { usage.inputTokens = 0; usage.outputTokens = 0; usage.calls = 0; };

/** Print usage summary to console. */
export const printUsage = () => {
  console.log(`  ~ LLM usage: ${usage.calls} calls, ${(usage.inputTokens / 1e6).toFixed(2)}M in, ${(usage.outputTokens / 1e6).toFixed(2)}M out`);
};

// ─── Retry ───

const MAX_RETRIES = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Kimi K2.5 thinking cleanup ───

/**
 * Strip thinking/reasoning preamble from Kimi K2.5 output.
 * Kimi puts all output in reasoning_content; the thinking prefix
 * contains meta-commentary that should be removed.
 */
const THINKING_PATTERNS = [
  /^The user (wants|is asking|asked|needs|would like)/i,
  /^Let me (analyze|think|consider|review|parse|extract|look|check|go through|start|break|scan|draft|identify|organize)/i,
  /^I (need to|should|will|must|can|'ll|'m going to)/i,
  /^(Now|First|Next|Finally|So|OK|Alright|Here|Looking|Based on|Wait|Actually|Hmm|Given)/i,
  /^(This is|The (input|structure|format|output|task|goal|data|question|request|very|most))/i,
  /^\d+\.\s+\*\*/,
  /^(Requirements|Format|Sections|Rules|Output|Instructions|Key requirements|Structure):/i,
  /^(My approach|Strategy|Plan|Steps):/i,
  /^-\s+(Start with|Recent Patterns|Historical Summary|Topics Index)/,
];

const stripThinking = (raw) => {
  if (!raw) return "";
  const mdBlock = raw.match(/```(?:markdown)?\n([\s\S]+?)```\s*$/);
  if (mdBlock) return mdBlock[1].trim();

  const lines = raw.split("\n");
  const filtered = [];
  let inThinking = true;

  for (const line of lines) {
    const trimmed = line.trimStart();
    if (inThinking) {
      if (trimmed === "") continue;
      const isThinking = THINKING_PATTERNS.some(p => p.test(trimmed));
      if (isThinking) continue;
      inThinking = false;
    }
    filtered.push(line);
  }

  return filtered.join("\n").trim();
};

// ─── Models ───

/** Default model configuration. Override with env vars. */
export const MODELS = {
  ANSWER: process.env.MEMAWARE_MODEL || "accounts/fireworks/models/kimi-k2p5",
  JUDGE: process.env.MEMAWARE_JUDGE || "gpt-4o-mini-2024-07-18",
};

// ─── Chat completion ───

/**
 * Send a chat completion request with retry and concurrency control.
 * @param {string} model - Model identifier (OpenAI or Fireworks)
 * @param {string} systemPrompt - System message
 * @param {string} userPrompt - User message
 * @param {Object} [opts] - Options
 * @param {number} [opts.temperature=0] - Sampling temperature
 * @param {number} [opts.maxTokens=2048] - Max output tokens
 * @param {number} [opts.seed=42] - Seed for reproducibility (OpenAI only)
 * @returns {Promise<string>} Model response text
 */
export const chatComplete = async (model, systemPrompt, userPrompt, opts = {}) => {
  const { temperature = 0, maxTokens = 2048, seed = 42 } = opts;
  const isFireworks = model.startsWith("accounts/fireworks/");
  const client = getClientForModel(model);

  await acquire();
  try {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        if (isFireworks) {
          // Streaming for Fireworks/Kimi: reasoning_content handling
          const stream = await client.chat.completions.create({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            temperature,
            max_tokens: maxTokens,
            stream: true,
          });

          let content = "";
          let reasoning = "";
          let promptTokens = 0;
          let completionTokens = 0;

          for await (const chunk of stream) {
            const delta = chunk.choices?.[0]?.delta;
            if (delta?.content) content += delta.content;
            if (delta?.reasoning_content) reasoning += delta.reasoning_content;
            if (chunk.usage) {
              promptTokens = chunk.usage.prompt_tokens || 0;
              completionTokens = chunk.usage.completion_tokens || 0;
            }
          }

          usage.inputTokens += promptTokens;
          usage.outputTokens += completionTokens;
          usage.calls++;

          const raw = content || reasoning;
          return stripThinking(raw);
        }

        // Non-streaming for OpenAI
        const response = await client.chat.completions.create({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature,
          max_tokens: maxTokens,
          seed,
        });

        if (response.usage) {
          usage.inputTokens += response.usage.prompt_tokens || 0;
          usage.outputTokens += response.usage.completion_tokens || 0;
        }
        usage.calls++;
        return response.choices[0].message.content;

      } catch (err) {
        const isRetryable = err.status === 429 || err.status >= 500;
        if (!isRetryable || attempt === MAX_RETRIES - 1) throw err;
        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
        console.log(`  ~ Retry ${attempt + 1}/${MAX_RETRIES}: ${err.message}`);
        await sleep(delay);
      }
    }
  } finally {
    release();
  }
};
