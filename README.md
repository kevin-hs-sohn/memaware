# MemAware

Benchmark for measuring **memory awareness** in AI agents — the ability to surface relevant past context without being asked.

## Why This Benchmark Exists

Every existing memory benchmark asks the same question: *"Can your system find the answer in past conversations?"*

[LoCoMo](https://snap-research.github.io/locomo/) gives you a long conversation and asks factual questions about it. [LongMemEval](https://github.com/xiaowu0162/LongMemEval) does the same with multi-session histories. [MemoryAgentBench](https://github.com/HUST-AI-HYZ/MemoryAgentBench) tests retrieval, learning, understanding, and forgetting. These are all useful benchmarks — but they all test the **search engine**, not the **memory system**.

Here's the gap: in real multi-session agent work, the hardest memory problem isn't finding something you're looking for. It's **knowing that something relevant exists when nobody asked about it.**

### The problem, illustrated

Here are real questions from MemAware. In each case, the user makes a request. Somewhere in 3 months of conversation history, there's context the agent should proactively surface — but the user never mentions it.

**Easy** — keyword overlap exists, search could find it:

> **User:** "Luna keeps scratching the new sofa. Can you suggest some deterrents or training techniques?"
>
> **What the agent should recall:** The user's cat is named Luna.
>
> **Why it matters:** The agent should recognize Luna as the user's cat and tailor advice accordingly — not ask "is Luna a cat or a dog?"

A keyword search for "Luna scratching sofa" might find past sessions mentioning Luna. This tier confirms that memory-aware systems perform at least as well as search-only approaches.

**Medium** — same domain, different words. Search returns noise:

> **User:** "I'm trying to plan my morning routine so I can arrive at the office by 8:30 AM. What time should I set my alarm?"
>
> **What the agent should recall:** The user's daily commute takes 45 minutes each way.
>
> **Why it matters:** Without recalling the commute duration, the agent can only give generic advice. With it, the agent can calculate: "Given your 45-minute commute, set your alarm for 7:00 AM."

Searching "morning routine alarm office" returns sessions about schedules, meetings, productivity — but not the commute discussion. The 45-minute fact is buried in a conversation about work-life balance from 6 weeks ago.

**Hard** — cross-domain, no keyword overlap. Search structurally cannot find it:

> **User:** "My college transcript request was denied because the registrar said there's no record matching my current name from when I graduated in 2010."
>
> **What the agent should recall:** The user's last name was Johnson before they changed it.
>
> **Why it matters:** Academic records from 2010 are filed under the previous name. The agent should immediately surface this — "Your records are likely under your previous name, Johnson." But "transcript request" and "name change" share zero keywords.

There is no search query that connects these. The connection only exists if the agent has a **holistic view** of the user's history.

### Where existing benchmarks fall short

| User request | What should be recalled | Would search find it? | Tested by existing benchmarks? |
|---|---|---|---|
| "Luna keeps scratching the sofa" | Luna is the user's cat | **Yes** — keyword match | **Yes** (LoCoMo, LongMemEval) |
| "What time should I set my alarm?" | 45-minute commute | **Maybe** — noisy results | **No** |
| "Transcript denied, no record under my name" | Previous last name was Johnson | **No** — zero keyword overlap | **No** |
| "Suggest a variation of the lavender gin fizz with honey" | User tried this recipe last weekend | **Maybe** — if "gin fizz" matches | **No** |
| "My Ford Mustang needs a new air filter. Good store nearby?" | User redeems coupons at Target | **No** — different domain entirely | **No** |

The first row is all that existing benchmarks cover. MemAware covers all five.

### When searching makes things worse

Most RAG-based agents "always search memory before responding." In practice, this creates two failure modes:

**Wasted tokens:** The user asks "What time should I set my alarm?" The agent searches, reads ~5K tokens of session results about schedules and meetings, finds nothing about commute time, and gives generic advice. Cost: ~4.6K tokens for zero benefit.

**False positive pollution:** The user asks about their Ford Mustang's air filter. The agent searches "Ford Mustang air filter," retrieves sessions mentioning cars and maintenance. The relevant context (Target coupon history) isn't found, but irrelevant results fill the context window and may actively mislead the response.

Our baseline results confirm this: **BM25 search scores 2.8% on implicit context while consuming 5x the tokens of no memory (0.8%)**. Searching without awareness of what to search for is expensive and nearly useless.

## What MemAware Measures

### 900 Implicit Context Questions, 3 Difficulty Tiers

The agent receives a task request where related past context exists but **isn't mentioned in the request**. The agent should proactively surface the connection — referencing the past context, incorporating it into the response, or at minimum acknowledging its relevance.

All questions pass a **leaking filter**: if >30% of the key terms from the expected recall appear in the question itself, the question is rejected. This ensures the agent must actually recall information, not just read the question.

#### Easy (300 questions) — keyword overlap exists

The request shares a domain with the past context, but the specific facts must be recalled from memory.

> **User:** "Can you suggest a variation of the lavender gin fizz that uses honey instead of simple syrup?"
> **Should recall:** The user tried a lavender gin fizz cocktail recipe last weekend.

> **User:** "I'm planning to make onigiri for lunch tomorrow. Short-grain or basmati rice?"
> **Should recall:** Japanese short-grain rice is the user's favorite type of rice.

#### Medium (300 questions) — same domain, different words

The request and past context share a domain but not keywords. Search returns noisy, diluted results.

> **User:** "I'm applying for a management consulting internship and need help positioning my formal training in organizational leadership within my cover letter."
> **Should recall:** The user graduated with a Business Administration degree.

> **User:** "I need to pick up more of that refrigerated dairy mixer for my morning caffeine fix. Which big-box store did I go to when I had that promotional voucher?"
> **Should recall:** The user redeemed a $5 coupon on coffee creamer at Target.

#### Hard (300 questions) — cross-domain, abstract connection

No keyword or domain overlap. The connection requires reasoning across different parts of the user's history.

> **User:** "My Ford Mustang needs a new air filter and I want to pick up some car wax. Is there a store nearby where I can use my loyalty discounts?"
> **Should recall:** The user redeems coupons at Target.
> **Connection:** Target sells automotive supplies and the user has an established coupon/discount relationship there.

> **User:** "My college transcript request was denied because the registrar has no record matching my current name from 2010."
> **Should recall:** The user's last name was Johnson before they changed it.
> **Connection:** Academic records are filed under the previous legal name.

> **User:** "I'm curating a photo book from my June beach trips and want the digital organization to feel cohesive with my other summer projects."
> **Should recall:** The user has a Spotify playlist named "Summer Vibes."
> **Connection:** Naming the photo collection "Summer Vibes" maintains thematic consistency across summer media.

### Evaluation

**Continuity accuracy:** Did the agent proactively surface the related past context? The agent must explicitly reference specific personal details from memory that align with the expected recall. General knowledge that happens to match does not count — the response must demonstrate awareness of the user's specific history. Judged by GPT-5.1.

Each response is classified:

| Type | Description |
|------|-------------|
| **correct** | Explicitly referenced the right past context from memory |
| **abstained** | Responded without referencing any past context |
| **hallucinated** | Referenced past context that doesn't exist or is wrong |
| **partial** | Referenced related but different past context |

**Token efficiency:** Total API tokens consumed per question, including system prompt, search results, and all LLM output.

## Baseline Results

3-month window (April–June 2023), 1,307 sessions (~14/day, realistic agent usage density), 900 implicit-only questions (300 per tier). Answer model: Kimi K2.5 via Fireworks. Judge: GPT-5.1.

### Accuracy

| Method | Easy (n=300) | Medium (n=300) | Hard (n=300) | **Overall (n=900)** |
|--------|:---:|:---:|:---:|:---:|
| No Memory | 1.0% | 0.7% | 0.7% | **0.8%** |
| BM25 Search | 4.7% | 1.7% | 2.0% | **2.8%** |
| BM25 + Vector Search | 6.0% | 3.7% | 0.7% | **3.4%** |

### Token Efficiency (median tokens per question)

| Method | Easy | Medium | Hard |
|--------|:---:|:---:|:---:|
| No Memory | 0.6k | 0.9k | 1.0k |
| BM25 Search | 4.6k | 4.9k | 4.6k |
| BM25 + Vector Search | 1.8k | 1.7k | 1.8k |

### Key Findings

1. **Search without awareness is nearly useless.** BM25 search scores 2.8% overall — a marginal improvement over no memory (0.8%) that costs 5x the tokens. On medium and hard tiers, BM25 adds noise without finding relevant context.

2. **Vector search helps on easy, fails on hard.** BM25+Vector reaches 6.0% on easy (keyword overlap helps embeddings too) but drops to 0.7% on hard — the same as no memory. Semantic similarity cannot bridge cross-domain connections like "transcript request" → "name change."

3. **Hard-tier implicit context is unsolved by pure search.** No search-only approach exceeds 2.0% on hard questions. Finding connections like "Ford Mustang air filter" → "Target coupons" requires a holistic overview of the user's history, not better retrieval.

4. **The token cost of always-searching is real.** BM25 consumes ~4.7K tokens per question regardless of outcome — 5x the cost of no memory, for 2 percentage points of improvement. Over hundreds of interactions, this waste compounds.

These baselines establish the floor. Memory systems that maintain pre-loaded overviews, hierarchical summaries, or topic indices should be evaluated against these numbers.

## Data

### Source

Built on [LongMemEval](https://github.com/xiaowu0162/LongMemEval) (Wu et al., ICLR 2025, MIT license). We use the S variant's conversation sessions, filtered to a 3-month window (April–June 2023) for realistic scale.

### Construction

1. **Session pruning:** Raw sessions are pruned from ~15K to 1,307 to achieve realistic density (~14 sessions/day, matching active AI agent usage patterns). All answer-bearing sessions are preserved; remaining slots are filled by deterministic sampling.

2. **Question generation:** For each answerable LongMemEval question, one implicit context question is generated by Kimi K2.5 at an assigned difficulty tier. The model receives the answer sessions and generates a task request that requires recalling past context without explicitly asking for it.

3. **Quality filters:**
   - **Leaking filter:** Questions where >30% of should_recall keywords appear in the question text are rejected. This prevents questions that contain their own answers.
   - **Format filter:** Incomplete, placeholder, or malformed questions are rejected.
   - **Difficulty tiers:** Easy = keyword overlap with past context. Medium = same domain, different words. Hard = cross-domain, abstract connection.

4. **Final dataset:** 900 questions (300 per tier), each verified to not leak answers.

### Format

```json
{
  "question_id": "implicit_v4_hard_7161e7e2",
  "type": "implicit_context",
  "difficulty": "hard",
  "question": "My college transcript was denied because the registrar has no record matching my current name.",
  "has_context": true,
  "source_question_id": "7161e7e2",
  "answer": "Johnson",
  "answer_session_ids": ["session_047"],
  "should_recall": "The user's last name was Johnson before they changed it",
  "connection": "Academic records from 2010 are filed under the previous legal name"
}
```

## Quick Start

```bash
# Install
npm install

# Set API keys
export OPENAI_API_KEY="..."      # for judge (GPT-5.1)
export FIREWORKS_API_KEY="..."   # for answer model (Kimi K2.5)

# Run all baseline conditions
node run.mjs --condition all

# Run a single condition
node run.mjs --condition bm25-search

# Score results
node score.mjs
```

### Adding Your Own Memory System

MemAware is designed to evaluate any memory architecture. To add your system:

```bash
cp conditions/example-custom.mjs conditions/my-system.mjs
```

Implement the `evaluate(question, context)` interface:

```javascript
export async function evaluate(question, context) {
  // context.memoryDir — path to compacted memory files (daily/, weekly/, monthly/, ROOT.md)
  // context.mapping   — Map of file paths to session IDs
  // context.search    — BM25 search function: (query, k) => results[]

  // Your memory system's logic here:
  // 1. Load any pre-built indices, summaries, or topic overviews
  // 2. Decide whether past context is relevant to the request
  // 3. Retrieve specific details if needed (search, tree traversal, etc.)
  // 4. Generate response that references past context when relevant

  return { response: "..." };
}
```

Then run:

```bash
node run.mjs --condition my-system
node score.mjs
```

## How MemAware Relates to Other Benchmarks

| Benchmark | What it measures | Covers implicit context? |
|-----------|-----------------|:---:|
| [LoCoMo](https://snap-research.github.io/locomo/) (ACL 2024) | QA over long conversations | No |
| [LongMemEval](https://github.com/xiaowu0162/LongMemEval) (ICLR 2025) | Multi-session retrieval accuracy | No |
| [MemoryAgentBench](https://github.com/HUST-AI-HYZ/MemoryAgentBench) (2025) | Retrieval + learning + forgetting | No |
| [MemoryArena](https://memoryarena.github.io/) (2026) | Multi-session task completion | Partially |
| **MemAware** | **Proactive surfacing of un-queried context** | **Yes — the only benchmark that tests this** |

MemAware is complementary to existing benchmarks. Use LoCoMo or LongMemEval to measure retrieval quality. Use MemAware to measure whether the agent can surface what it wasn't asked about.

## Citation

**[Technical Report (PDF)](paper/memaware.pdf)** — MemAware: Benchmarking Implicit Context Surfacing in AI Agent Memory (Hyeon Seok Son, 2026)

If you use MemAware in your research, please cite:

```bibtex
@misc{son2026memaware,
  title={MemAware: Benchmarking Implicit Context Surfacing in AI Agent Memory},
  author={Son, Hyeon Seok},
  year={2026},
  url={https://github.com/kevin-hs-sohn/memaware}
}
```

MemAware uses data derived from [LongMemEval](https://github.com/xiaowu0162/LongMemEval) (Wu et al., ICLR 2025) under the MIT license.

## License

MIT
