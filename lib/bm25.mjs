/**
 * In-process BM25 ranking.
 * Okapi BM25 with k1=1.2, b=0.75.
 */

const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "dare", "ought",
  "used", "to", "of", "in", "for", "on", "with", "at", "by", "from",
  "as", "into", "through", "during", "before", "after", "above", "below",
  "between", "out", "off", "over", "under", "again", "further", "then",
  "once", "here", "there", "when", "where", "why", "how", "all", "both",
  "each", "few", "more", "most", "other", "some", "such", "no", "nor",
  "not", "only", "own", "same", "so", "than", "too", "very", "just",
  "because", "but", "and", "or", "if", "while", "that", "this", "it",
  "i", "me", "my", "we", "our", "you", "your", "he", "him", "his",
  "she", "her", "they", "them", "their", "what", "which", "who", "whom",
]);

const K1 = 1.2;
const B = 0.75;

/** Tokenize text into lowercase terms, removing stop words and punctuation. */
const tokenize = (text) =>
  text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));

/**
 * Build a BM25 index from an array of documents.
 * @param {{ id: string, text: string }[]} docs
 * @returns {Object} BM25 index
 */
export const buildIndex = (docs) => {
  const N = docs.length;
  const docTokens = docs.map((d) => tokenize(d.text));
  const avgDl = docTokens.reduce((sum, t) => sum + t.length, 0) / N;

  const df = {};
  for (const tokens of docTokens) {
    const seen = new Set(tokens);
    for (const t of seen) {
      df[t] = (df[t] || 0) + 1;
    }
  }

  const idf = {};
  for (const [term, freq] of Object.entries(df)) {
    idf[term] = Math.log((N - freq + 0.5) / (freq + 0.5) + 1);
  }

  const tfDocs = docTokens.map((tokens) => {
    const tf = {};
    for (const t of tokens) {
      tf[t] = (tf[t] || 0) + 1;
    }
    return { tf, dl: tokens.length };
  });

  return { docs, idf, tfDocs, avgDl, N };
};

/**
 * Search the index for the top-k results matching the query.
 * @param {Object} index - BM25 index from buildIndex()
 * @param {string} query - Search query text
 * @param {number} [k=10] - Number of results to return
 * @returns {{ id: string, score: number }[]}
 */
export const search = (index, query, k = 10) => {
  const queryTokens = tokenize(query);
  const scores = [];

  for (let i = 0; i < index.N; i++) {
    const { tf, dl } = index.tfDocs[i];
    let score = 0;

    for (const qt of queryTokens) {
      if (!index.idf[qt]) continue;
      const freq = tf[qt] || 0;
      const numerator = freq * (K1 + 1);
      const denominator = freq + K1 * (1 - B + B * (dl / index.avgDl));
      score += index.idf[qt] * (numerator / denominator);
    }

    if (score > 0) {
      scores.push({ id: index.docs[i].id, score });
    }
  }

  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, k);
};
