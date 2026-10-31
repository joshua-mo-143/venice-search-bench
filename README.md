# venice-search-bench

A benchmark for the web search providers behind Venice's [web search endpoint](https://docs.venice.ai/api-reference/endpoint/augment/search): `brave`, `google`, and `exa`, compared with each other and with answering without search.

It asks two questions about each provider:

- **Retrieval:** are the results relevant, and do they contain the answer?
- **Answers:** does a model answer correctly when it's given those results?

## Results

From the run on 30 October 2026, with every result as returned:

| Provider | Accuracy | nDCG@5 | Per-page nDCG@5 | p50 latency | Cost per 1,000 queries |
| --- | ---: | ---: | ---: | ---: | ---: |
| `brave` | 78.2% | 0.60 | 0.68 | 0.97 s | $16.04 |
| `google` | 75.6% | 0.43 | 0.48 | 4.52 s | $30.04 |
| `exa` | 93.6% | 0.75 | 0.77 | 0.71 s | $16.32 |
| No search | 0.6% | — | — | — | $1.56 |

Accuracy is out of 156 questions with a gold answer. Every question was screened so the answer model can't answer it without search (see [How the questions were made](#how-the-questions-were-made)), so the no-search row is close to zero by design.

Exa's lead is significant against both: it answered 28 questions that Brave missed, against 4 the other way, and 33 that Google missed, against 5 (exact McNemar p < 0.001 for both). Brave and Google are level (22 against 18, p = 0.64).

nDCG@5 scores the text each provider sent back, while per-page nDCG@5 scores the pages it ranked: when two providers return the same page, both copies get the better score, so a short extract isn't marked down against a longer copy. Brave's and Exa's results are about the same length (1,506 and 1,655 characters on average in the top 5), and Exa's lead holds per page: 0.09 (95% CI 0.05 to 0.13). Both found a known-good source in the top 5 about as often (49% and 52%), but the judge could read the answer from Exa's top 5 for 92% of questions, against 73% for Brave.

Google returned 5 results per search, against 10 for the others, but each was full page text, starting at the top of the page: 9,698 characters on average. When the top 5 results are cut to about 2,000 tokens, Google's accuracy drops to 44.2%, while Brave (76.9%) and Exa (91.0%) barely move, because the cut keeps the start of each result and often loses the passage with the answer. At about 8,000 tokens, Google recovers to 72.4%.

Accuracy by question set:

| Questions | n | `brave` | `google` | `exa` | No search |
| --- | ---: | ---: | ---: | ---: | ---: |
| Release notes | 61 | 65.6% | 62.3% | 91.8% | 1.6% |
| Developer docs | 19 | 89.5% | 94.7% | 94.7% | 0.0% |
| Venice API | 11 | 72.7% | 81.8% | 100.0% | 0.0% |
| Research | 19 | 63.2% | 63.2% | 78.9% | 0.0% |
| News | 23 | 100.0% | 95.7% | 100.0% | 0.0% |
| Sensitive topics | 23 | 95.7% | 82.6% | 100.0% | 0.0% |

Most of Exa's lead comes from release notes, where it answered 56 of 61 questions, against 40 for Brave and 38 for Google. On news and developer docs, all three answered nearly everything.

On the 23 sensitive questions, no provider returned an empty result or an error, and the answer model never refused to answer one because of its topic. Every miss but one was a search that didn't turn up the fact, or turned up a different one. The other was a hedged Google answer with the right date, which the judge marked as not attempted. This shows no filtering on these questions, which is a narrower claim than showing there's no filtering anywhere.

The 6 general questions have no gold answer, so a judge compared the providers' answers head to head instead. Six questions can't separate the providers, but the comparison is in the report.

The first run, on 29 October, couldn't separate the providers either: without search, the model already answered 72% of its 29 questions with a gold answer. Its 47 questions are in the history at commit 681e1cd, the coding ones are kept in `data/easy-coding.jsonl`, and the results are in [`results/2026-10-29/`](results/2026-10-29/report.md).

The full report, with confidence intervals, paired comparisons, and per-slice breakdowns, is in [`results/2026-10-30/report.md`](results/2026-10-30/report.md). The same folder has every answer with its grade, and every provider's result list. The write-up is [Benchmarking Web Search Providers](https://docs.venice.ai/learn/search-provider-benchmark).

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
| Per-page nDCG@5 | nDCG@5 with each page given the best score any provider's copy of it got, so it compares the pages ranked rather than the text returned |
| Answer in results | The judge checks whether the gold answer can be read from the full text of the top 5 results |
| Gold URL hit@5 and MRR@5 | Rank of the first result in the top 5 matching a known-good source URL, without a judge |
| Authoritative share | Share of the top 5 results from official docs, package registries, and code hosts |
| Identifier coverage | Share of expected identifiers, like flag or function names, that appear verbatim |
| Pairwise preference | With `--pairwise`, the judge compares two providers' answers to a question without a gold answer, twice with the order swapped |
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
bun run bench run --budget 55
```

The harness prints a cost estimate before it starts and stops if the estimate is above `--budget` (default $5). The full query set cost $36.10 on 30 October with `--pairwise`: $4.86 for 486 searches at $0.01 each, plus answer and judge tokens. The estimate leaves out cache discounts, so it comes in higher, at about $50.

You don't need to pay for a run to check the results: [`results/`](results/) has the report files from every published run.

Runs are resumable. If one stops partway, finished steps are saved and the error message prints the resume command.

## Query set

A run uses seven files in `data/` by default: 162 questions, 156 of them with a gold answer.

| File | Questions | What they ask |
| --- | ---: | --- |
| `releases.jsonl` | 61 | Coding questions from the release notes of 61 projects, such as Rust, Node.js, uv, and Helm |
| `docs.jsonl` | 19 | Limits, quotas, and plan details from developer docs, such as function timeouts and rate limits |
| `venice-docs.jsonl` | 11 | The Venice API, answered from the [published docs](https://docs.venice.ai) |
| `research.jsonl` | 19 | Questions that need two sources, such as who supervised the PhD of the 2026 Knuth Prize winner |
| `news.jsonl` | 23 | Events from 17 to 28 October 2026, mostly from official announcements |
| `sensitive.jsonl` | 23 | Factual questions on legal topics that some services filter, such as drug law, abortion, sex work, firearms, surveillance, censorship, and internet shutdowns |
| `general.jsonl` | 6 | Long conversational questions and questions on sensitive topics, with no gold answer, for retrieval scores and pairwise comparison |

Two more files aren't in the default set:

- **`easy-coding.jsonl` (19):** the hand-written coding questions from the first run. The model answered 15 of the 16 with a gold answer without search, so they don't separate the providers.
- **`screened-out.jsonl` (14):** questions dropped because the model answered them without search.

`bun run bench import simpleqa` and `bun run bench import frames --n 20` sample public question sets ([SimpleQA](https://github.com/openai/simple-evals) and [FRAMES](https://huggingface.co/datasets/google/frames-benchmark)) into `data/`. They're not in the default set because their questions and answers are published on the web, where search results can find them.

### How the questions were made

Every question with a gold answer was written for this benchmark, and went through these steps:

1. **Written from a source.** AI agents drafted each question from a primary source, such as a release note, a docs page, or an official press release, plus a second source where one exists. The gold answer had to be stated in the source, with the quote it comes from.
2. **Source check.** A script fetched every source and confirmed that each quote appears on the page.
3. **No-search screen.** The answer model answered every question twice without search, and any question it got right either time was dropped.
4. **Open-book check.** For the news and sensitive questions, the model was also given the source quotes as its search results, and had to answer correctly both times. This catches ambiguous questions, and checks that the model will answer a sensitive question when it has the source.
5. **Review.** Another agent double-checked every question and gold answer against the sources. 47 questions were reworded or had their gold answer corrected, 3 were dropped, and every edited question went through the no-search screen again.

Gold answers lead with the answer, and anything after it is context that a correct answer doesn't need to repeat.

### File format

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
| `source`, `tags` | No | Where the question came from, and topic labels; not used in grading |

Check a query file with `bun run bench validate --dataset path/to/file.jsonl`, then run it with `--dataset`.

## Output

Each run writes to `runs/<run-id>/`:

- `report.md`: accuracy, the equal-budget matrix, retrieval quality, speed and cost, paired comparisons, per-slice and coding breakdowns, and pairwise preference.
- `results.csv`: one row per question, provider, and condition.
- `summary.json`: the headline numbers.
- `answers.jsonl`: every answer, with its grade.
- `hits.jsonl`: each provider's ranked results for every question, with titles, URLs, dates, page-text lengths, and relevance scores, but not the page text.
- Per-step JSON for every search, answer, and grade.

Rebuild the report for a finished run with `bun run bench report --run <run-id>`. `runs/` is ignored by Git because it holds full search results; `results/` keeps the report files from published runs.

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

- **The questions were picked to need search.** The screen dropped every question the answer model could answer on its own, so the set is harder than everyday traffic, and the no-search baseline tells you nothing about how often search helps in general.
- **The screen used one model.** A model with newer training data might know some of the answers.
- **The questions were written with AI agents.** Every one was checked against its sources and reviewed, but a gold answer can still be wrong. If you find one, open an issue.
- **Some question sets are small.** Across all 156 gold answers, accuracy intervals are up to about ±7 points, but the Venice API set has 11 questions and the research set 19. Read the paired comparisons before calling a difference within a set real.
- **Release notes are 61 of the 156 gold answers.** Overall accuracy leans on them, so check the table by question set too.
- **The grades come from a model.** We checked every answer the judge didn't mark correct in the native condition (82) and 30 that it did. We'd change 6, all from wrong to right: 3 for Brave, 2 for Google, and 1 for Exa. That gives 80.1%, 76.9%, and 94.2%, with the same ranking. Spot-check `answers.jsonl` before trusting small differences.
- **Results change.** Search results are a snapshot at fetch time, and time-sensitive gold answers, especially news, go stale. Check `validAsOf`.
- **Latency includes Venice, and it moves between runs.** It's measured from the client through the Venice API, so compare providers within a run, not with their own published numbers. Exa's median was 0.71 s on 30 October, against 1.73 s on 29 October.
- **Token budgets are approximate, and they keep the start of each result.** The budgeted conditions assume 4 characters per token. Cutting from the end suits short extracts better than long page text, where the useful passage can sit further down.
- **nDCG@5 scores the text, not just the ranking.** A short extract can score lower than a longer copy of the same page. Per-page nDCG@5 corrects for that on pages more than one provider returned, but pages only one provider returned keep that provider's format.

## License

[MIT](LICENSE)
