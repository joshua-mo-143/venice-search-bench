# Search benchmark: 20261112-214401-breaking-1112

- Created: 2026-11-12T21:44:01.234Z
- Queries: 10 (10 with gold answers) across news, sent to every provider as written
- Arms: brave, google, exa, none (no search); search limit 10
- Models: answer `zai-org-glm-5-2` (thinking off), judge `grok-4-7`
- Spend: $1.74 (search $0.30, answers $0.37, judge $1.07), priced from recorded token usage with 306,368 cache-read tokens at the discounted rate

## Answer accuracy (queries with a gold answer)

Graded CORRECT / INCORRECT / NOT_ATTEMPTED by the judge model. Answers whose search failed count as not attempted. Answer errors are excluded from n.

| Arm | Condition | n | Correct | 95% CI | Incorrect | Not attempted | Correct when attempted | Answer errors |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| brave | native (as returned) | 10 | 100.0% | 72.2% – 100.0% | 0.0% | 0.0% | 100.0% | 0 |
| google | native (as returned) | 10 | 100.0% | 72.2% – 100.0% | 0.0% | 0.0% | 100.0% | 0 |
| exa | native (as returned) | 10 | 100.0% | 72.2% – 100.0% | 0.0% | 0.0% | 100.0% | 0 |
| none (no search) | native (as returned) | 10 | 0.0% | 0.0% – 27.8% | 70.0% | 30.0% | 0.0% | 0 |
| brave | top 5, 2k tokens | 10 | 100.0% | 72.2% – 100.0% | 0.0% | 0.0% | 100.0% | 0 |
| google | top 5, 2k tokens | 10 | 80.0% | 49.0% – 94.3% | 10.0% | 10.0% | 88.9% | 0 |
| exa | top 5, 2k tokens | 10 | 100.0% | 72.2% – 100.0% | 0.0% | 0.0% | 100.0% | 0 |
| brave | top 5, 8k tokens | 10 | 100.0% | 72.2% – 100.0% | 0.0% | 0.0% | 100.0% | 0 |
| google | top 5, 8k tokens | 10 | 100.0% | 72.2% – 100.0% | 0.0% | 0.0% | 100.0% | 0 |
| exa | top 5, 8k tokens | 10 | 100.0% | 72.2% – 100.0% | 0.0% | 0.0% | 100.0% | 0 |

## Equal-budget matrix: correct answers

Same answers as above, arranged so each column gives every provider the same number of results and the same token budget (except native). Budgets keep the start of each result and cut the rest.

| Arm | native (as returned) | top 5, 2k tokens | top 5, 8k tokens |
| --- | ---: | ---: | ---: |
| brave | 100% (n=10) | 100% (n=10) | 100% (n=10) |
| google | 100% (n=10) | 80% (n=10) | 100% (n=10) |
| exa | 100% (n=10) | 100% (n=10) | 100% (n=10) |
| none (no search) | 0% (n=10) | — | — |

## Retrieval quality (results as returned)

The judge reads the full text of each of the top 5 results. P@5 counts results it scored 2 or 3; nDCG@5 is normalised against five perfect results. Per-page nDCG@5 gives every copy of a page the best score any provider's copy of it got, so it compares the pages each provider ranked rather than the text it sent back. Errors and empty results score 0. "Answer in results" asks the judge whether the gold answer can be read from the top 5 results; "gold string" is an exact normalised match against all returned text. Gold URL hit and MRR also stop at rank 5, so every provider is scored on the same number of results.

| Arm | n | Empty | Errors | Mean results | Mean content chars | P@5 | nDCG@5 | Per-page nDCG@5 | Answer in results | Gold string in results | Gold URL hit@5 | MRR@5 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| brave | 10 | 0.0% | 0.0% | 10.0 | 14471 | 0.94 | 0.92 | 0.93 | 100.0% (n=10) | — | 70.0% (n=10) | 0.44 |
| google | 10 | 0.0% | 0.0% | 5.0 | 35810 | 0.58 | 0.64 | 0.64 | 100.0% (n=10) | — | 20.0% (n=10) | 0.08 |
| exa | 10 | 0.0% | 0.0% | 10.0 | 6769 | 0.96 | 0.97 | 0.97 | 100.0% (n=10) | — | 50.0% (n=10) | 0.40 |

Pages in more than one provider's top 5: 17 provider pairs, scored the same in 94% of them. Where the scores differed, the shorter copy scored lower in 100% of pairs.

## Speed, reliability, and cost

Latency is client-side through the Venice API, so it includes Venice and network overhead; compare arms against each other rather than against provider benchmarks. Percentiles time the final attempt; "all attempts" adds time spent on failed attempts. Neither includes the harness's own rate limiting or retry backoff. Cost per 1,000 queries uses the native condition and zai-org-glm-5-2 list pricing at run time, with no cache discount because search results differ on every request.

| Arm | Searches | p50 ms | p90 ms | p99 ms | Mean ms, all attempts | Mean attempts | Errors | Empty | Search $/1k | Mean answer prompt tokens | Answer $/1k | Total $/1k |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| brave | 10 | 961 | 1200 | 1663 | 1034 | 1.00 | 0.0% | 0.0% | $10.00 | 3741 | $5.47 | $15.47 |
| google | 10 | 3665 | 6438 | 6856 | 4009 | 1.00 | 0.0% | 0.0% | $10.00 | 10697 | $15.16 | $25.16 |
| exa | 10 | 758 | 1914 | 2101 | 1029 | 1.00 | 0.0% | 0.0% | $10.00 | 2214 | $3.32 | $13.32 |
| none (no search) | — | — | — | — | — | — | — | — | $0.00 | 42 | $0.32 | $0.32 |

## Paired comparisons

Each comparison uses only queries both arms have a grade for. Δ is the first arm minus the second, with a 95% paired bootstrap interval. The "Only A" and "Only B" columns are the discordant pairs behind the exact McNemar p-value. Intervals that cross 0 are not a measured difference.

| Pair (A vs B) | Condition | n | Δ correct (pp) | 95% CI (pp) | Only A correct | Only B correct | McNemar p |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| brave vs google | native (as returned) | 10 | +0.0 | +0.0 – +0.0 | 0 | 0 | 1.000 |
| brave vs exa | native (as returned) | 10 | +0.0 | +0.0 – +0.0 | 0 | 0 | 1.000 |
| brave vs none | native (as returned) | 10 | +100.0 | +100.0 – +100.0 | 10 | 0 | 0.002 |
| google vs exa | native (as returned) | 10 | +0.0 | +0.0 – +0.0 | 0 | 0 | 1.000 |
| google vs none | native (as returned) | 10 | +100.0 | +100.0 – +100.0 | 10 | 0 | 0.002 |
| exa vs none | native (as returned) | 10 | +100.0 | +100.0 – +100.0 | 10 | 0 | 0.002 |
| brave vs google | top 5, 2k tokens | 10 | +20.0 | +0.0 – +50.0 | 2 | 0 | 0.500 |
| brave vs exa | top 5, 2k tokens | 10 | +0.0 | +0.0 – +0.0 | 0 | 0 | 1.000 |
| google vs exa | top 5, 2k tokens | 10 | -20.0 | -50.0 – +0.0 | 0 | 2 | 0.500 |
| brave vs google | top 5, 8k tokens | 10 | +0.0 | +0.0 – +0.0 | 0 | 0 | 1.000 |
| brave vs exa | top 5, 8k tokens | 10 | +0.0 | +0.0 – +0.0 | 0 | 0 | 1.000 |
| google vs exa | top 5, 8k tokens | 10 | +0.0 | +0.0 – +0.0 | 0 | 0 | 1.000 |

### Retrieval nDCG@5

| Pair (A vs B) | n | Δ nDCG@5 | 95% CI |
| --- | ---: | ---: | ---: |
| brave vs google | 10 | +0.273 | +0.122 – +0.417 |
| brave vs exa | 10 | -0.049 | -0.165 – +0.067 |
| google vs exa | 10 | -0.322 | -0.430 – -0.214 |

### Retrieval per-page nDCG@5

| Pair (A vs B) | n | Δ per-page nDCG@5 | 95% CI |
| --- | ---: | ---: | ---: |
| brave vs google | 10 | +0.285 | +0.129 – +0.429 |
| brave vs exa | 10 | -0.036 | -0.153 – +0.072 |
| google vs exa | 10 | -0.322 | -0.430 – -0.214 |

### Gold URL hit@5

| Pair (A vs B) | n | Δ hit (pp) | 95% CI (pp) | Only A hit | Only B hit | McNemar p |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| brave vs google | 10 | +50.0 | +10.0 – +90.0 | 6 | 1 | 0.125 |
| brave vs exa | 10 | +20.0 | -30.0 – +70.0 | 4 | 2 | 0.688 |
| google vs exa | 10 | -30.0 | -70.0 – +10.0 | 1 | 4 | 0.375 |

## By slice (native)

| Slice | n | brave correct | google correct | exa correct | none correct | brave nDCG@5 | google nDCG@5 | exa nDCG@5 | brave no results | google no results | exa no results |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| news | 10 | 100% | 100% | 100% | 0% | 0.92 | 0.64 | 0.97 | 0% | 0% | 0% |

No results counts searches that came back empty or failed.

## Notes

- Providers return different numbers of results and different amounts of text per result (see "Mean results" and "Mean content chars"). The budgeted conditions even out that volume, but because they keep the start of each result, they work against results whose useful text sits further down the page.
- nDCG@5 scores the text each provider sent back, so a short extract can score lower than a longer copy of the same page. Per-page nDCG@5 removes that difference for pages more than one provider returned; pages only one provider returned keep that provider's format.
- Empty results get a closed-book answer, and failed searches count as not attempted.
- Grades come from an LLM judge. Spot-check `results.csv` and the per-query JSON before trusting small differences.
- Search results are a snapshot at fetch time, and gold answers can go stale; check `validAsOf` on time-sensitive queries.
