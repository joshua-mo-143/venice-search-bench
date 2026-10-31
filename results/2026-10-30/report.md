# Search benchmark: 20261030-220037-v3

- Created: 2026-10-30T22:00:37.331Z
- Queries: 162 (156 with gold answers) across coding, general, news, research, sensitive, sent to every provider as written
- Arms: brave, google, exa, none (no search); search limit 10
- Models: answer `zai-org-glm-5-2` (thinking off), judge `grok-4-7`
- Spend: $36.10 (search $4.86, answers $8.71, judge $22.53), priced from recorded token usage with 4,951,488 cache-read tokens at the discounted rate

## Answer accuracy (queries with a gold answer)

Graded CORRECT / INCORRECT / NOT_ATTEMPTED by the judge model. Answers whose search failed count as not attempted. Answer errors are excluded from n.

| Arm | Condition | n | Correct | 95% CI | Incorrect | Not attempted | Correct when attempted | Answer errors |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| brave | native (as returned) | 156 | 78.2% | 71.1% – 84.0% | 12.8% | 9.0% | 85.9% | 0 |
| google | native (as returned) | 156 | 75.6% | 68.3% – 81.7% | 14.1% | 10.3% | 84.3% | 0 |
| exa | native (as returned) | 156 | 93.6% | 88.6% – 96.5% | 5.8% | 0.6% | 94.2% | 0 |
| none (no search) | native (as returned) | 156 | 0.6% | 0.1% – 3.5% | 87.8% | 11.5% | 0.7% | 0 |
| brave | top 5, 2k tokens | 156 | 76.9% | 69.7% – 82.8% | 14.7% | 8.3% | 83.9% | 0 |
| google | top 5, 2k tokens | 156 | 44.2% | 36.7% – 52.1% | 25.6% | 30.1% | 63.3% | 0 |
| exa | top 5, 2k tokens | 156 | 91.0% | 85.5% – 94.6% | 8.3% | 0.6% | 91.6% | 0 |
| brave | top 5, 8k tokens | 156 | 77.6% | 70.4% – 83.4% | 12.8% | 9.6% | 85.8% | 0 |
| google | top 5, 8k tokens | 156 | 72.4% | 64.9% – 78.8% | 13.5% | 14.1% | 84.3% | 0 |
| exa | top 5, 8k tokens | 156 | 92.9% | 87.8% – 96.0% | 3.8% | 3.2% | 96.0% | 0 |

## Equal-budget matrix: correct answers

Same answers as above, arranged so each column gives every provider the same number of results and the same token budget (except native). Budgets keep the start of each result and cut the rest.

| Arm | native (as returned) | top 5, 2k tokens | top 5, 8k tokens |
| --- | ---: | ---: | ---: |
| brave | 78% (n=156) | 77% (n=156) | 78% (n=156) |
| google | 76% (n=156) | 44% (n=156) | 72% (n=156) |
| exa | 94% (n=156) | 91% (n=156) | 93% (n=156) |
| none (no search) | 1% (n=156) | — | — |

## Retrieval quality (results as returned)

The judge reads the full text of each of the top 5 results. P@5 counts results it scored 2 or 3; nDCG@5 is normalised against five perfect results. Per-page nDCG@5 gives every copy of a page the best score any provider's copy of it got, so it compares the pages each provider ranked rather than the text it sent back. Errors and empty results score 0. "Answer in results" asks the judge whether the gold answer can be read from the top 5 results; "gold string" is an exact normalised match against all returned text. Gold URL hit and MRR also stop at rank 5, so every provider is scored on the same number of results.

| Arm | n | Empty | Errors | Mean results | Mean content chars | P@5 | nDCG@5 | Per-page nDCG@5 | Answer in results | Gold string in results | Gold URL hit@5 | MRR@5 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| brave | 162 | 0.0% | 0.0% | 10.0 | 14650 | 0.63 | 0.60 | 0.68 | 73.1% (n=156) | 18.2% (n=11) | 49.4% (n=156) | 0.34 |
| google | 162 | 0.0% | 0.0% | 5.0 | 48490 | 0.39 | 0.43 | 0.48 | 69.2% (n=156) | 9.1% (n=11) | 27.6% (n=156) | 0.22 |
| exa | 162 | 0.0% | 0.0% | 10.0 | 13851 | 0.79 | 0.75 | 0.77 | 91.7% (n=156) | 18.2% (n=11) | 51.9% (n=156) | 0.41 |

Pages in more than one provider's top 5: 523 provider pairs, scored the same in 71% of them. Where the scores differed, the shorter copy scored lower in 69% of pairs.

## Speed, reliability, and cost

Latency is client-side through the Venice API, so it includes Venice and network overhead; compare arms against each other rather than against provider benchmarks. Percentiles time the final attempt; "all attempts" adds time spent on failed attempts. Neither includes the harness's own rate limiting or retry backoff. Cost per 1,000 queries uses the native condition and zai-org-glm-5-2 list pricing at run time, with no cache discount because search results differ on every request.

| Arm | Searches | p50 ms | p90 ms | p99 ms | Mean ms, all attempts | Mean attempts | Errors | Empty | Search $/1k | Mean answer prompt tokens | Answer $/1k | Total $/1k |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| brave | 162 | 966 | 1141 | 1530 | 1017 | 1.00 | 0.0% | 0.0% | $10.00 | 3868 | $6.04 | $16.04 |
| google | 162 | 4516 | 7020 | 7984 | 4805 | 1.00 | 0.0% | 0.0% | $10.00 | 13901 | $20.04 | $30.04 |
| exa | 162 | 711 | 832 | 1749 | 751 | 1.00 | 0.0% | 0.0% | $10.00 | 4027 | $6.32 | $16.32 |
| none (no search) | — | — | — | — | — | — | — | — | $0.00 | 40 | $1.56 | $1.56 |

## Paired comparisons

Each comparison uses only queries both arms have a grade for. Δ is the first arm minus the second, with a 95% paired bootstrap interval. The "Only A" and "Only B" columns are the discordant pairs behind the exact McNemar p-value. Intervals that cross 0 are not a measured difference.

| Pair (A vs B) | Condition | n | Δ correct (pp) | 95% CI (pp) | Only A correct | Only B correct | McNemar p |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| brave vs google | native (as returned) | 156 | +2.6 | -5.1 – +10.3 | 22 | 18 | 0.636 |
| brave vs exa | native (as returned) | 156 | -15.4 | -22.4 – -9.0 | 4 | 28 | 0.000 |
| brave vs none | native (as returned) | 156 | +77.6 | +71.2 – +84.0 | 121 | 0 | 0.000 |
| google vs exa | native (as returned) | 156 | -17.9 | -25.6 – -10.9 | 5 | 33 | 0.000 |
| google vs none | native (as returned) | 156 | +75.0 | +67.9 – +81.4 | 117 | 0 | 0.000 |
| exa vs none | native (as returned) | 156 | +92.9 | +88.5 – +96.8 | 145 | 0 | 0.000 |
| brave vs google | top 5, 2k tokens | 156 | +32.7 | +24.4 – +41.0 | 57 | 6 | 0.000 |
| brave vs exa | top 5, 2k tokens | 156 | -14.1 | -21.2 – -7.1 | 6 | 28 | 0.000 |
| google vs exa | top 5, 2k tokens | 156 | -46.8 | -55.8 – -38.5 | 4 | 77 | 0.000 |
| brave vs google | top 5, 8k tokens | 156 | +5.1 | -3.8 – +14.1 | 30 | 22 | 0.332 |
| brave vs exa | top 5, 8k tokens | 156 | -15.4 | -23.1 – -8.3 | 7 | 31 | 0.000 |
| google vs exa | top 5, 8k tokens | 156 | -20.5 | -28.2 – -13.5 | 5 | 37 | 0.000 |

### Retrieval nDCG@5

| Pair (A vs B) | n | Δ nDCG@5 | 95% CI |
| --- | ---: | ---: | ---: |
| brave vs google | 162 | +0.173 | +0.133 – +0.214 |
| brave vs exa | 162 | -0.148 | -0.186 – -0.111 |
| google vs exa | 162 | -0.321 | -0.360 – -0.284 |

### Retrieval per-page nDCG@5

| Pair (A vs B) | n | Δ per-page nDCG@5 | 95% CI |
| --- | ---: | ---: | ---: |
| brave vs google | 162 | +0.198 | +0.159 – +0.238 |
| brave vs exa | 162 | -0.090 | -0.126 – -0.054 |
| google vs exa | 162 | -0.287 | -0.328 – -0.248 |

### Gold URL hit@5

| Pair (A vs B) | n | Δ hit (pp) | 95% CI (pp) | Only A hit | Only B hit | McNemar p |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| brave vs google | 156 | +21.8 | +14.7 – +28.8 | 38 | 4 | 0.000 |
| brave vs exa | 156 | -2.6 | -11.5 – +5.8 | 23 | 27 | 0.672 |
| google vs exa | 156 | -24.4 | -32.7 – -16.0 | 6 | 44 | 0.000 |

## By slice (native)

| Slice | n | brave correct | google correct | exa correct | none correct | brave nDCG@5 | google nDCG@5 | exa nDCG@5 | brave no results | google no results | exa no results |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| coding | 91 | 71% | 71% | 93% | 1% | 0.57 | 0.38 | 0.75 | 0% | 0% | 0% |
| general | 6 | — | — | — | — | 0.66 | 0.49 | 0.77 | 0% | 0% | 0% |
| news | 23 | 100% | 96% | 100% | 0% | 0.93 | 0.63 | 0.94 | 0% | 0% | 0% |
| research | 19 | 63% | 63% | 79% | 0% | 0.29 | 0.27 | 0.43 | 0% | 0% | 0% |
| sensitive | 23 | 96% | 83% | 100% | 0% | 0.63 | 0.54 | 0.86 | 0% | 0% | 0% |

No results counts searches that came back empty or failed.

## Coding

Authoritative share counts top-5 results from official docs, registries, and code hosts (plus per-query domains). Identifier coverage is case-sensitive and verbatim, so a renamed flag or misspelled API is a miss.

### By sub-slice

| sub-slice | Arm | n | Correct | nDCG@5 | Gold URL hit@5 | Authoritative share (top 5) | Identifiers in results | Identifiers in answer |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| docs | brave | 19 | 89% | 0.61 | 89% | 66% | 100% | 100% |
| docs | google | 19 | 95% | 0.53 | 89% | 45% | 100% | 100% |
| docs | exa | 19 | 95% | 0.75 | 84% | 80% | 100% | 100% |
| docs | none | 19 | 0% | — | — | — | — | 0% |
| releases | brave | 61 | 66% | 0.55 | 30% | 51% | 76% | 76% |
| releases | google | 61 | 62% | 0.33 | 0% | 22% | 68% | 68% |
| releases | exa | 61 | 92% | 0.73 | 20% | 51% | 97% | 97% |
| releases | none | 61 | 2% | — | — | — | — | 20% |
| venice-api | brave | 11 | 73% | 0.63 | 82% | 47% | 71% | 57% |
| venice-api | google | 11 | 82% | 0.40 | 64% | 33% | 100% | 100% |
| venice-api | exa | 11 | 100% | 0.79 | 100% | 76% | 100% | 100% |
| venice-api | none | 11 | 0% | — | — | — | — | 14% |

### By style

| style | Arm | n | Correct | nDCG@5 | Gold URL hit@5 | Authoritative share (top 5) | Identifiers in results | Identifiers in answer |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| error-string | brave | 5 | 20% | 0.68 | 20% | 72% | 100% | 100% |
| error-string | google | 5 | 60% | 0.29 | 0% | 24% | 50% | 0% |
| error-string | exa | 5 | 80% | 0.79 | 40% | 56% | 50% | 50% |
| error-string | none | 5 | 0% | — | — | — | — | 50% |
| identifier | brave | 10 | 90% | 0.56 | 50% | 58% | 100% | 100% |
| identifier | google | 10 | 70% | 0.32 | 20% | 30% | 60% | 40% |
| identifier | exa | 10 | 90% | 0.78 | 30% | 50% | 100% | 100% |
| identifier | none | 10 | 10% | — | — | — | — | 40% |
| keyword | brave | 14 | 93% | 0.65 | 64% | 56% | 83% | 83% |
| keyword | google | 14 | 86% | 0.53 | 36% | 29% | 92% | 92% |
| keyword | exa | 14 | 93% | 0.82 | 50% | 66% | 100% | 100% |
| keyword | none | 14 | 0% | — | — | — | — | 17% |
| natural-language | brave | 42 | 74% | 0.61 | 60% | 52% | 74% | 74% |
| natural-language | google | 42 | 76% | 0.41 | 36% | 27% | 76% | 83% |
| natural-language | exa | 42 | 95% | 0.77 | 55% | 59% | 100% | 100% |
| natural-language | none | 42 | 0% | — | — | — | — | 16% |
| version-pinned | brave | 20 | 55% | 0.43 | 20% | 51% | 40% | 20% |
| version-pinned | google | 20 | 55% | 0.28 | 10% | 31% | 60% | 60% |
| version-pinned | exa | 20 | 95% | 0.61 | 20% | 64% | 100% | 100% |
| version-pinned | none | 20 | 0% | — | — | — | — | 0% |

## Pairwise preference (queries without a gold answer, native)

Each pair is judged twice with positions swapped; a split decision counts as a tie. Citation markers are stripped so the judge cannot tell which answers had search.

| Pair (A vs B) | n | A wins | Ties | B wins | A win rate excl. ties |
| --- | ---: | ---: | ---: | ---: | ---: |
| brave vs google | 6 | 2 | 4 | 0 | 100% |
| brave vs exa | 6 | 2 | 2 | 2 | 50% |
| brave vs none | 6 | 4 | 1 | 1 | 80% |
| google vs exa | 6 | 1 | 1 | 4 | 20% |
| google vs none | 6 | 4 | 1 | 1 | 80% |
| exa vs none | 6 | 5 | 0 | 1 | 83% |

## Notes

- Providers return different numbers of results and different amounts of text per result (see "Mean results" and "Mean content chars"). The budgeted conditions even out that volume, but because they keep the start of each result, they work against results whose useful text sits further down the page.
- nDCG@5 scores the text each provider sent back, so a short extract can score lower than a longer copy of the same page. Per-page nDCG@5 removes that difference for pages more than one provider returned; pages only one provider returned keep that provider's format.
- Empty results get a closed-book answer, and failed searches count as not attempted.
- Grades come from an LLM judge. Spot-check `results.csv` and the per-query JSON before trusting small differences.
- Search results are a snapshot at fetch time, and gold answers can go stale; check `validAsOf` on time-sensitive queries.
