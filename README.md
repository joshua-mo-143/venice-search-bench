# venice-search-bench

A benchmark for the web search providers behind Venice's [web search endpoint](https://docs.venice.ai/api-reference/endpoint/augment/search): `brave`, `google`, and `exa`, compared with each other and with answering without search.

It asks two questions about each provider:

- **Retrieval:** are the results relevant, and do they contain the answer?
- **Answers:** does a model answer correctly when it's given those results?

## Results

From the run on 29 October 2026, with every result as returned:

| Provider | Accuracy | nDCG@5 | p50 latency | Cost per 1,000 queries |
| --- | ---: | ---: | ---: | ---: |
| `brave` | 89.7% | 0.66 | 0.90 s | $16.50 |
| `google` | 89.7% | 0.64 | 4.58 s | $35.60 |
| `exa` | 96.6% | 0.78 | 1.73 s | $20.19 |
| No search | 72.4% | — | — | $2.23 |

Accuracy is out of 29 questions with a gold answer, so differences of a question or two aren't significant. The full report, with confidence intervals, paired comparisons, and per-slice breakdowns, is in [`results/2026-10-29/report.md`](results/2026-10-29/report.md). The write-up is [Benchmarking Web Search Providers](https://docs.venice.ai/learn/search-provider-benchmark).

## How a run works

For every question in the query set, the harness:

1. Sends the question, as written, to `POST /augment/search` once per provider, with `limit` set to 10.
2. Answers it with one model (`zai-org-glm-5-2` by default) under three conditions:
   - `native`: every result as the provider returned it.
   - `k5-2k`: the top 5 results, cut to fit about 2,000 tokens.
   - `k5-8k`: the top 5 results, cut to fit about 8,000 tokens.

   A closed-book answer with no search is the baseline. The two budgeted conditions give every provider the same number of results and the same amount of text. They keep the start of each result, so they also show how well results hold up when you cut them: short extracts lose little, while long page text can lose the passage that answered the question.
3. Grades the results and answers with a judge model (`grok-4-7` by default, temperature 0).

### Metrics

| Metric | How it's computed |
| --- | --- |
| Accuracy | The judge grades each answer CORRECT, INCORRECT, or NOT_ATTEMPTED against a gold answer |
| P@5 and nDCG@5 | The judge reads the full text of each of the top 5 results and scores it from 0 (irrelevant) to 3 (answers the question) |
| Answer in results | The judge checks whether the gold answer can be read from the full text of the top 5 results |
| Gold URL hit@5 and MRR@5 | Rank of the first result in the top 5 matching a known-good source URL, without a judge |
| Authoritative share | Share of the top 5 results from official docs, package registries, and code hosts |
| Identifier coverage | Share of expected identifiers, like flag or function names, that appear verbatim |
| Latency and cost | Client-side search latency, and search plus answer cost per 1,000 queries |

Accuracy gets a Wilson 95% interval. Differences between providers get a paired bootstrap interval (5,000 resamples, fixed seed) and an exact McNemar test, using only the questions both providers were graded on.

## Requirements

- [Bun](https://bun.sh) 1.4 or later
- A [Venice API key](https://venice.ai/settings/api) with some balance, for live runs

## Quick start

Install, run the tests, and try the whole pipeline offline. The mock backend is deterministic and spends nothing.

```bash
bun install
bun test
bun run bench run --mock
```

For a live run, create a `.env` file in the repository root:

```
VENICE_API_KEY=your-key
```

Then run the full query set:

```bash
bun run bench run --budget 15
```

The harness prints a cost estimate before it starts and stops if the estimate is above `--budget` (default $5). The full query set costs about $10: 141 searches at $0.01 each, plus answer and judge tokens. The estimate leaves out cache discounts, so it comes in a little higher.

Runs are resumable. If one stops partway, finished steps are saved and the error message prints the resume command.

## Query set

`data/seed.jsonl` holds 47 questions, 29 of them with a gold answer:

- **General (23):** facts, news, prices, rankings, opinion, sensitive topics, long conversational questions, and questions in Spanish, German, Japanese, Korean, and Portuguese.
- **Coding (24):** error messages, API lookups, config and CLI questions, recent releases, library choices, and questions about the Venice API.

Each line is a JSON object:

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | Yes | Unique identifier |
| `slice` | Yes | Group for reporting, like `general` or `coding` |
| `query` | Yes | The question, at most 400 characters |
| `subSlice`, `style`, `language` | No | Finer grouping for the report |
| `goldAnswer` | No | The answer accuracy is graded against |
| `goldUrls` | No | Sources that answer the question, for hit@5 and MRR@5 |
| `goldIdentifiers` | No | Strings a good result or answer should contain verbatim |
| `authoritativeDomains` | No | Extra domains to count as authoritative |
| `validAsOf` | No | Date a time-sensitive gold answer was checked |

Check a query file with `bun run bench validate --dataset path/to/file.jsonl`, then run it with `--dataset`.

## Output

Each run writes to `runs/<run-id>/`:

- `report.md`: accuracy, the equal-budget matrix, retrieval quality, speed and cost, paired comparisons, and per-slice and coding breakdowns.
- `results.csv`: one row per question, provider, and condition.
- `summary.json`: the headline numbers.
- Per-step JSON for every search, answer, and grade.

Rebuild the report for a finished run with `bun run bench report --run <run-id>`. `runs/` is ignored by Git because it holds full search results; `results/` keeps the aggregated files from published runs.

## Options

`bun run bench --help` lists every command and option. The ones you're most likely to need:

| Option | Default | Use |
| --- | --- | --- |
| `--arms` | `brave,google,exa,none` | Providers to compare |
| `--conditions` | `native,k5-2k,k5-8k` | Result conditions to answer under |
| `--limit` | All questions | Sample this many questions, stratified by slice |
| `--answer-model`, `--judge-model` | `zai-org-glm-5-2`, `grok-4-7` | Models for answering and grading |
| `--citations` | Off | Also check that cited results support each claim |
| `--pairwise` | Off | Also compare answers head-to-head on questions without a gold answer |

`bun run bench models` lists the private-tier text models you can use.

## Limitations

- **The query set is small.** With 29 gold answers, accuracy intervals are wide. Read the paired comparisons before calling a difference real.
- **The grades come from a model.** Spot-check `results.csv` and the per-question JSON before trusting small differences.
- **Results change.** Search results are a snapshot at fetch time, and time-sensitive gold answers go stale. Check `validAsOf`.
- **Latency includes Venice.** It's measured from the client through the Venice API, so compare providers with each other, not with their own published numbers.
- **Token budgets are approximate, and they keep the start of each result.** The budgeted conditions assume 4 characters per token. Cutting from the end suits short extracts better than long page text, where the useful passage can sit further down.

## License

[MIT](LICENSE)
