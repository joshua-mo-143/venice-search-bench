# Search benchmark: 20261111-210043-rerun-1111

- Created: 2026-11-11T21:00:43.708Z
- Queries: 162 (156 with gold answers) across coding, general, news, research, sensitive, sent to every provider as written
- Arms: brave, google, exa, none (no search); search limit 10
- Models: answer `zai-org-glm-5-2` (thinking off), judge `grok-4-7`
- Spend: $38.10 (search $4.86, answers $9.14, judge $24.11), priced from recorded token usage with 5,097,856 cache-read tokens at the discounted rate

## Answer accuracy (queries with a gold answer)

Graded CORRECT / INCORRECT / NOT_ATTEMPTED by the judge model. Answers whose search failed count as not attempted. Answer errors are excluded from n.

| Arm | Condition | n | Correct | 95% CI | Incorrect | Not attempted | Correct when attempted | Answer errors |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| brave | native (as returned) | 156 | 81.4% | 74.6% – 86.7% | 12.2% | 6.4% | 87.0% | 0 |
| google | native (as returned) | 156 | 72.4% | 64.9% – 78.8% | 12.2% | 15.4% | 85.6% | 0 |
| exa | native (as returned) | 156 | 93.6% | 88.6% – 96.5% | 5.1% | 1.3% | 94.8% | 0 |
| none (no search) | native (as returned) | 156 | 1.3% | 0.4% – 4.6% | 87.8% | 10.9% | 1.4% | 0 |
| brave | top 5, 2k tokens | 156 | 82.7% | 76.0% – 87.8% | 10.3% | 7.1% | 89.0% | 0 |
| google | top 5, 2k tokens | 156 | 45.5% | 37.9% – 53.3% | 21.2% | 33.3% | 68.3% | 0 |
| exa | top 5, 2k tokens | 156 | 92.3% | 87.0% – 95.5% | 7.1% | 0.6% | 92.9% | 0 |
| brave | top 5, 8k tokens | 156 | 82.7% | 76.0% – 87.8% | 9.6% | 7.7% | 89.6% | 0 |
| google | top 5, 8k tokens | 156 | 70.5% | 62.9% – 77.1% | 14.1% | 15.4% | 83.3% | 0 |
| exa | top 5, 8k tokens | 156 | 93.6% | 88.6% – 96.5% | 5.1% | 1.3% | 94.8% | 0 |

## Equal-budget matrix: correct answers

Same answers as above, arranged so each column gives every provider the same number of results and the same token budget (except native). Budgets keep the start of each result and cut the rest.

| Arm | native (as returned) | top 5, 2k tokens | top 5, 8k tokens |
| --- | ---: | ---: | ---: |
| brave | 81% (n=156) | 83% (n=156) | 83% (n=156) |
| google | 72% (n=156) | 46% (n=156) | 71% (n=156) |
| exa | 94% (n=156) | 92% (n=156) | 94% (n=156) |
| none (no search) | 1% (n=156) | — | — |

## Retrieval quality (results as returned)

The judge reads the full text of each of the top 5 results. P@5 counts results it scored 2 or 3; nDCG@5 is normalised against five perfect results. Per-page nDCG@5 gives every copy of a page the best score any provider's copy of it got, so it compares the pages each provider ranked rather than the text it sent back. Errors and empty results score 0. "Answer in results" asks the judge whether the gold answer can be read from the top 5 results; "gold string" is an exact normalised match against all returned text. Gold URL hit and MRR also stop at rank 5, so every provider is scored on the same number of results.

| Arm | n | Empty | Errors | Mean results | Mean content chars | P@5 | nDCG@5 | Per-page nDCG@5 | Answer in results | Gold string in results | Gold URL hit@5 | MRR@5 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| brave | 162 | 0.0% | 0.0% | 10.0 | 15061 | 0.66 | 0.63 | 0.71 | 78.8% (n=156) | 9.1% (n=11) | 48.7% (n=156) | 0.37 |
| google | 162 | 0.6% | 0.0% | 5.0 | 57772 | 0.46 | 0.47 | 0.49 | 67.3% (n=156) | 18.2% (n=11) | 31.4% (n=156) | 0.23 |
| exa | 162 | 0.0% | 0.0% | 10.0 | 15646 | 0.83 | 0.80 | 0.82 | 92.3% (n=156) | 27.3% (n=11) | 47.4% (n=156) | 0.40 |

Pages in more than one provider's top 5: 590 provider pairs, scored the same in 73% of them. Where the scores differed, the shorter copy scored lower in 69% of pairs.

## Speed, reliability, and cost

Latency is client-side through the Venice API, so it includes Venice and network overhead; compare arms against each other rather than against provider benchmarks. Percentiles time the final attempt; "all attempts" adds time spent on failed attempts. Neither includes the harness's own rate limiting or retry backoff. Cost per 1,000 queries uses the native condition and zai-org-glm-5-2 list pricing at run time, with no cache discount because search results differ on every request.

| Arm | Searches | p50 ms | p90 ms | p99 ms | Mean ms, all attempts | Mean attempts | Errors | Empty | Search $/1k | Mean answer prompt tokens | Answer $/1k | Total $/1k |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| brave | 162 | 993 | 1181 | 1759 | 1009 | 1.00 | 0.0% | 0.0% | $10.00 | 3972 | $6.20 | $16.20 |
| google | 162 | 5363 | 7064 | 8365 | 5284 | 1.00 | 0.0% | 0.6% | $10.00 | 15844 | $22.78 | $32.78 |
| exa | 162 | 1537 | 2382 | 3891 | 1495 | 1.00 | 0.0% | 0.0% | $10.00 | 4432 | $6.98 | $16.98 |
| none (no search) | — | — | — | — | — | — | — | — | $0.00 | 40 | $1.70 | $1.70 |

## Paired comparisons

Each comparison uses only queries both arms have a grade for. Δ is the first arm minus the second, with a 95% paired bootstrap interval. The "Only A" and "Only B" columns are the discordant pairs behind the exact McNemar p-value. Intervals that cross 0 are not a measured difference.

| Pair (A vs B) | Condition | n | Δ correct (pp) | 95% CI (pp) | Only A correct | Only B correct | McNemar p |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| brave vs google | native (as returned) | 156 | +9.0 | +0.6 – +17.3 | 29 | 15 | 0.049 |
| brave vs exa | native (as returned) | 156 | -12.2 | -18.6 – -5.8 | 5 | 24 | 0.001 |
| brave vs none | native (as returned) | 156 | +80.1 | +73.7 – +86.5 | 125 | 0 | 0.000 |
| google vs exa | native (as returned) | 156 | -21.2 | -27.6 – -14.7 | 1 | 34 | 0.000 |
| google vs none | native (as returned) | 156 | +71.2 | +64.1 – +78.2 | 111 | 0 | 0.000 |
| exa vs none | native (as returned) | 156 | +92.3 | +87.8 – +96.2 | 144 | 0 | 0.000 |
| brave vs google | top 5, 2k tokens | 156 | +37.2 | +28.2 – +46.2 | 66 | 8 | 0.000 |
| brave vs exa | top 5, 2k tokens | 156 | -9.6 | -16.0 – -3.2 | 6 | 21 | 0.006 |
| google vs exa | top 5, 2k tokens | 156 | -46.8 | -55.1 – -38.5 | 3 | 76 | 0.000 |
| brave vs google | top 5, 8k tokens | 156 | +12.2 | +3.8 – +19.9 | 32 | 13 | 0.007 |
| brave vs exa | top 5, 8k tokens | 156 | -10.9 | -17.3 – -5.1 | 4 | 21 | 0.001 |
| google vs exa | top 5, 8k tokens | 156 | -23.1 | -30.1 – -16.0 | 2 | 38 | 0.000 |

### Retrieval nDCG@5

| Pair (A vs B) | n | Δ nDCG@5 | 95% CI |
| --- | ---: | ---: | ---: |
| brave vs google | 162 | +0.153 | +0.115 – +0.194 |
| brave vs exa | 162 | -0.173 | -0.208 – -0.137 |
| google vs exa | 162 | -0.326 | -0.363 – -0.291 |

### Retrieval per-page nDCG@5

| Pair (A vs B) | n | Δ per-page nDCG@5 | 95% CI |
| --- | ---: | ---: | ---: |
| brave vs google | 162 | +0.223 | +0.188 – +0.259 |
| brave vs exa | 162 | -0.105 | -0.136 – -0.074 |
| google vs exa | 162 | -0.328 | -0.364 – -0.292 |

### Gold URL hit@5

| Pair (A vs B) | n | Δ hit (pp) | 95% CI (pp) | Only A hit | Only B hit | McNemar p |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| brave vs google | 156 | +17.3 | +10.3 – +25.0 | 34 | 7 | 0.000 |
| brave vs exa | 156 | +1.3 | -7.1 – +9.6 | 24 | 22 | 0.883 |
| google vs exa | 156 | -16.0 | -24.4 – -7.7 | 10 | 35 | 0.000 |

## By slice (native)

| Slice | n | brave correct | google correct | exa correct | none correct | brave nDCG@5 | google nDCG@5 | exa nDCG@5 | brave no results | google no results | exa no results |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| coding | 91 | 75% | 70% | 91% | 2% | 0.61 | 0.42 | 0.79 | 0% | 1% | 0% |
| general | 6 | — | — | — | — | 0.66 | 0.56 | 0.76 | 0% | 0% | 0% |
| news | 23 | 100% | 96% | 100% | 0% | 0.93 | 0.78 | 0.99 | 0% | 0% | 0% |
| research | 19 | 74% | 58% | 89% | 0% | 0.33 | 0.27 | 0.50 | 0% | 0% | 0% |
| sensitive | 23 | 96% | 70% | 100% | 0% | 0.64 | 0.53 | 0.91 | 0% | 0% | 0% |

No results counts searches that came back empty or failed.

## Coding

Authoritative share counts top-5 results from official docs, registries, and code hosts (plus per-query domains). Identifier coverage is case-sensitive and verbatim, so a renamed flag or misspelled API is a miss.

### By sub-slice

| sub-slice | Arm | n | Correct | nDCG@5 | Gold URL hit@5 | Authoritative share (top 5) | Identifiers in results | Identifiers in answer |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| docs | brave | 19 | 79% | 0.58 | 84% | 69% | 100% | 100% |
| docs | google | 19 | 89% | 0.56 | 89% | 58% | 100% | 100% |
| docs | exa | 19 | 95% | 0.87 | 89% | 61% | 100% | 100% |
| docs | none | 19 | 0% | — | — | — | — | 0% |
| releases | brave | 61 | 72% | 0.60 | 28% | 50% | 85% | 88% |
| releases | google | 61 | 62% | 0.37 | 0% | 30% | 72% | 70% |
| releases | exa | 61 | 89% | 0.75 | 15% | 49% | 97% | 97% |
| releases | none | 61 | 2% | — | — | — | — | 19% |
| venice-api | brave | 11 | 82% | 0.66 | 91% | 60% | 86% | 71% |
| venice-api | google | 11 | 82% | 0.43 | 64% | 38% | 86% | 86% |
| venice-api | exa | 11 | 100% | 0.84 | 91% | 69% | 100% | 100% |
| venice-api | none | 11 | 9% | — | — | — | — | 19% |

### By style

| style | Arm | n | Correct | nDCG@5 | Gold URL hit@5 | Authoritative share (top 5) | Identifiers in results | Identifiers in answer |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| error-string | brave | 5 | 60% | 0.77 | 20% | 68% | 100% | 100% |
| error-string | google | 5 | 40% | 0.38 | 0% | 32% | 0% | 0% |
| error-string | exa | 5 | 80% | 0.66 | 20% | 60% | 50% | 50% |
| error-string | none | 5 | 0% | — | — | — | — | 50% |
| identifier | brave | 10 | 80% | 0.62 | 40% | 60% | 100% | 100% |
| identifier | google | 10 | 50% | 0.43 | 10% | 36% | 80% | 60% |
| identifier | exa | 10 | 70% | 0.80 | 30% | 46% | 100% | 100% |
| identifier | none | 10 | 10% | — | — | — | — | 40% |
| keyword | brave | 14 | 86% | 0.70 | 71% | 64% | 100% | 100% |
| keyword | google | 14 | 93% | 0.53 | 36% | 37% | 92% | 92% |
| keyword | exa | 14 | 100% | 0.87 | 57% | 63% | 100% | 100% |
| keyword | none | 14 | 0% | — | — | — | — | 17% |
| natural-language | brave | 42 | 76% | 0.62 | 55% | 50% | 83% | 83% |
| natural-language | google | 42 | 74% | 0.43 | 38% | 38% | 74% | 76% |
| natural-language | exa | 42 | 93% | 0.82 | 48% | 51% | 100% | 100% |
| natural-language | none | 42 | 2% | — | — | — | — | 16% |
| version-pinned | brave | 20 | 65% | 0.47 | 25% | 56% | 60% | 60% |
| version-pinned | google | 20 | 65% | 0.32 | 10% | 37% | 80% | 80% |
| version-pinned | exa | 20 | 95% | 0.69 | 20% | 57% | 100% | 100% |
| version-pinned | none | 20 | 0% | — | — | — | — | 0% |

## Pairwise preference (queries without a gold answer, native)

Each pair is judged twice with positions swapped; a split decision counts as a tie. Citation markers are stripped so the judge cannot tell which answers had search.

| Pair (A vs B) | n | A wins | Ties | B wins | A win rate excl. ties |
| --- | ---: | ---: | ---: | ---: | ---: |
| brave vs google | 6 | 3 | 1 | 2 | 60% |
| brave vs exa | 6 | 1 | 1 | 4 | 20% |
| brave vs none | 6 | 4 | 1 | 1 | 80% |
| google vs exa | 6 | 1 | 1 | 4 | 20% |
| google vs none | 6 | 5 | 0 | 1 | 83% |
| exa vs none | 6 | 5 | 1 | 0 | 100% |

## Notes

- Providers return different numbers of results and different amounts of text per result (see "Mean results" and "Mean content chars"). The budgeted conditions even out that volume, but because they keep the start of each result, they work against results whose useful text sits further down the page.
- nDCG@5 scores the text each provider sent back, so a short extract can score lower than a longer copy of the same page. Per-page nDCG@5 removes that difference for pages more than one provider returned; pages only one provider returned keep that provider's format.
- Empty results get a closed-book answer, and failed searches count as not attempted.
- Grades come from an LLM judge. Spot-check `results.csv` and the per-query JSON before trusting small differences.
- Search results are a snapshot at fetch time, and gold answers can go stale; check `validAsOf` on time-sensitive queries.
