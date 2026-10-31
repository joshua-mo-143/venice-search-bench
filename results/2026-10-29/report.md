# Search benchmark: 20261029-184212-seed

- Created: 2026-10-29T18:42:12.698Z
- Queries: 47 (29 with gold answers) across coding, general, sent to every provider as written
- Arms: brave, google, exa, none (no search); search limit 10
- Models: answer `zai-org-glm-5-2` (thinking off), judge `grok-4-7`
- Spend: $10.25 (search $1.41, answers $3.19, judge $5.65), priced from recorded token usage with 1,155,328 cache-read tokens at the discounted rate

## Answer accuracy (queries with a gold answer)

Graded CORRECT / INCORRECT / NOT_ATTEMPTED by the judge model. Answers whose search failed count as not attempted. Answer errors are excluded from n.

| Arm | Condition | n | Correct | 95% CI | Incorrect | Not attempted | Correct when attempted | Answer errors |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| brave | native (as returned) | 29 | 89.7% | 73.6% – 96.4% | 3.4% | 6.9% | 96.3% | 0 |
| google | native (as returned) | 29 | 89.7% | 73.6% – 96.4% | 3.4% | 6.9% | 96.3% | 0 |
| exa | native (as returned) | 29 | 96.6% | 82.8% – 99.4% | 0.0% | 3.4% | 100.0% | 0 |
| none (no search) | native (as returned) | 29 | 72.4% | 54.3% – 85.3% | 24.1% | 3.4% | 75.0% | 0 |
| brave | top 5, 2k tokens | 29 | 89.7% | 73.6% – 96.4% | 6.9% | 3.4% | 92.9% | 0 |
| google | top 5, 2k tokens | 29 | 75.9% | 57.9% – 87.8% | 10.3% | 13.8% | 88.0% | 0 |
| exa | top 5, 2k tokens | 29 | 96.6% | 82.8% – 99.4% | 3.4% | 0.0% | 96.6% | 0 |
| brave | top 5, 8k tokens | 29 | 86.2% | 69.4% – 94.5% | 6.9% | 6.9% | 92.6% | 0 |
| google | top 5, 8k tokens | 29 | 86.2% | 69.4% – 94.5% | 6.9% | 6.9% | 92.6% | 0 |
| exa | top 5, 8k tokens | 29 | 96.6% | 82.8% – 99.4% | 3.4% | 0.0% | 96.6% | 0 |

## Equal-budget matrix: correct answers

Same answers as above, arranged so each column gives every provider the same number of results and the same token budget (except native). Budgets keep the start of each result and cut the rest.

| Arm | native (as returned) | top 5, 2k tokens | top 5, 8k tokens |
| --- | ---: | ---: | ---: |
| brave | 90% (n=29) | 90% (n=29) | 86% (n=29) |
| google | 90% (n=29) | 76% (n=29) | 86% (n=29) |
| exa | 97% (n=29) | 97% (n=29) | 97% (n=29) |
| none (no search) | 72% (n=29) | — | — |

## Retrieval quality (results as returned)

The judge reads the full text of each of the top 5 results. P@5 counts results it scored 2 or 3; nDCG@5 is normalised against five perfect results. Per-page nDCG@5 gives every copy of a page the best score any provider's copy of it got, so it compares the pages each provider ranked rather than the text it sent back. Errors and empty results score 0. "Answer in results" asks the judge whether the gold answer can be read from the top 5 results; "gold string" is an exact normalised match against all returned text. Gold URL hit and MRR also stop at rank 5, so every provider is scored on the same number of results.

| Arm | n | Empty | Errors | Mean results | Mean content chars | P@5 | nDCG@5 | Per-page nDCG@5 | Answer in results | Gold string in results | Gold URL hit@5 | MRR@5 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| brave | 47 | 0.0% | 0.0% | 10.0 | 14138 | 0.73 | 0.66 | 0.76 | 89.7% (n=29) | 81.8% (n=11) | 40.9% (n=22) | 0.31 |
| google | 47 | 0.0% | 0.0% | 5.0 | 59548 | 0.66 | 0.64 | 0.66 | 86.2% (n=29) | 81.8% (n=11) | 50.0% (n=22) | 0.42 |
| exa | 47 | 0.0% | 0.0% | 10.0 | 23223 | 0.85 | 0.78 | 0.80 | 96.6% (n=29) | 81.8% (n=11) | 72.7% (n=22) | 0.73 |

Pages in more than one provider's top 5: 184 provider pairs, scored the same in 64% of them. Where the scores differed, the shorter copy scored lower in 76% of pairs.

## Speed, reliability, and cost

Latency is client-side through the Venice API, so it includes Venice and network overhead; compare arms against each other rather than against provider benchmarks. Percentiles time the final attempt; "all attempts" adds time spent on failed attempts. Neither includes the harness's own rate limiting or retry backoff. Cost per 1,000 queries uses the native condition and zai-org-glm-5-2 list pricing at run time, with no cache discount because search results differ on every request.

| Arm | Searches | p50 ms | p90 ms | p99 ms | Mean ms, all attempts | Mean attempts | Errors | Empty | Search $/1k | Mean answer prompt tokens | Answer $/1k | Total $/1k |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| brave | 47 | 900 | 1070 | 2193 | 957 | 1.00 | 0.0% | 0.0% | $10.00 | 3708 | $6.50 | $16.50 |
| google | 47 | 4582 | 7384 | 9266 | 4776 | 1.00 | 0.0% | 0.0% | $10.00 | 17272 | $25.60 | $35.60 |
| exa | 47 | 1728 | 2325 | 3922 | 1844 | 1.00 | 0.0% | 0.0% | $10.00 | 6111 | $10.19 | $20.19 |
| none (no search) | — | — | — | — | — | — | — | — | $0.00 | 32 | $2.23 | $2.23 |

## Paired comparisons

Each comparison uses only queries both arms have a grade for. Δ is the first arm minus the second, with a 95% paired bootstrap interval. The "Only A" and "Only B" columns are the discordant pairs behind the exact McNemar p-value. Intervals that cross 0 are not a measured difference.

| Pair (A vs B) | Condition | n | Δ correct (pp) | 95% CI (pp) | Only A correct | Only B correct | McNemar p |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| brave vs google | native (as returned) | 29 | +0.0 | -10.3 – +10.3 | 1 | 1 | 1.000 |
| brave vs exa | native (as returned) | 29 | -6.9 | -17.2 – +0.0 | 0 | 2 | 0.500 |
| brave vs none | native (as returned) | 29 | +17.2 | +0.0 – +34.5 | 6 | 1 | 0.125 |
| google vs exa | native (as returned) | 29 | -6.9 | -20.7 – +6.9 | 1 | 3 | 0.625 |
| google vs none | native (as returned) | 29 | +17.2 | +0.0 – +37.9 | 7 | 2 | 0.180 |
| exa vs none | native (as returned) | 29 | +24.1 | +10.3 – +41.4 | 7 | 0 | 0.016 |
| brave vs google | top 5, 2k tokens | 29 | +13.8 | +3.4 – +27.6 | 4 | 0 | 0.125 |
| brave vs exa | top 5, 2k tokens | 29 | -6.9 | -20.7 – +6.9 | 1 | 3 | 0.625 |
| google vs exa | top 5, 2k tokens | 29 | -20.7 | -34.5 – -6.9 | 0 | 6 | 0.031 |
| brave vs google | top 5, 8k tokens | 29 | +0.0 | -13.8 – +13.8 | 2 | 2 | 1.000 |
| brave vs exa | top 5, 8k tokens | 29 | -10.3 | -24.1 – +3.4 | 1 | 4 | 0.375 |
| google vs exa | top 5, 8k tokens | 29 | -10.3 | -20.7 – +0.0 | 0 | 3 | 0.250 |

### Retrieval nDCG@5

| Pair (A vs B) | n | Δ nDCG@5 | 95% CI |
| --- | ---: | ---: | ---: |
| brave vs google | 47 | +0.024 | -0.043 – +0.087 |
| brave vs exa | 47 | -0.121 | -0.197 – -0.050 |
| google vs exa | 47 | -0.145 | -0.211 – -0.079 |

### Retrieval per-page nDCG@5

| Pair (A vs B) | n | Δ per-page nDCG@5 | 95% CI |
| --- | ---: | ---: | ---: |
| brave vs google | 47 | +0.101 | +0.044 – +0.157 |
| brave vs exa | 47 | -0.033 | -0.098 – +0.031 |
| google vs exa | 47 | -0.134 | -0.202 – -0.065 |

### Gold URL hit@5

| Pair (A vs B) | n | Δ hit (pp) | 95% CI (pp) | Only A hit | Only B hit | McNemar p |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| brave vs google | 22 | -9.1 | -31.8 – +13.6 | 2 | 4 | 0.688 |
| brave vs exa | 22 | -31.8 | -54.5 – -13.6 | 0 | 7 | 0.016 |
| google vs exa | 22 | -22.7 | -45.5 – +0.0 | 1 | 6 | 0.125 |

## By slice (native)

| Slice | n | brave correct | google correct | exa correct | none correct | brave nDCG@5 | google nDCG@5 | exa nDCG@5 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| coding | 24 | 86% | 86% | 95% | 76% | 0.68 | 0.60 | 0.78 |
| general | 23 | 100% | 100% | 100% | 63% | 0.63 | 0.67 | 0.78 |

## Coding

Authoritative share counts top-5 results from official docs, registries, and code hosts (plus per-query domains). Identifier coverage is case-sensitive and verbatim, so a renamed flag or misspelled API is a miss.

### By sub-slice

| sub-slice | Arm | n | Correct | nDCG@5 | Gold URL hit@5 | Authoritative share (top 5) | Identifiers in results | Identifiers in answer |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| api-lookup | brave | 4 | 100% | 0.91 | 75% | 45% | 100% | 100% |
| api-lookup | google | 4 | 75% | 0.83 | 75% | 55% | 100% | 100% |
| api-lookup | exa | 4 | 100% | 0.87 | 100% | 75% | 100% | 100% |
| api-lookup | none | 4 | 100% | — | — | — | — | 100% |
| config-cli | brave | 4 | 100% | 0.74 | 100% | 55% | 100% | 100% |
| config-cli | google | 4 | 100% | 0.69 | 100% | 50% | 100% | 100% |
| config-cli | exa | 4 | 100% | 0.82 | 100% | 95% | 100% | 100% |
| config-cli | none | 4 | 100% | — | — | — | — | 100% |
| errors | brave | 6 | 100% | 0.75 | 0% | 43% | 100% | 100% |
| errors | google | 6 | 100% | 0.70 | 0% | 40% | 100% | 100% |
| errors | exa | 6 | 100% | 0.81 | 40% | 67% | 100% | 100% |
| errors | none | 6 | 83% | — | — | — | — | 100% |
| library-choice | brave | 2 | — | 0.77 | — | 40% | — | — |
| library-choice | google | 2 | — | 0.57 | — | 40% | — | — |
| library-choice | exa | 2 | — | 0.71 | — | 50% | — | — |
| library-choice | none | 2 | — | — | — | — | — | — |
| releases | brave | 3 | 100% | 0.69 | 0% | 20% | — | — |
| releases | google | 3 | 100% | 0.71 | 50% | 47% | — | — |
| releases | exa | 3 | 100% | 0.77 | 50% | 60% | — | — |
| releases | none | 3 | 100% | — | — | — | — | — |
| venice-api | brave | 5 | 40% | 0.34 | 60% | 28% | 100% | 100% |
| venice-api | google | 5 | 60% | 0.19 | 40% | 36% | 100% | 100% |
| venice-api | exa | 5 | 80% | 0.66 | 80% | 84% | 100% | 100% |
| venice-api | none | 5 | 20% | — | — | — | — | 0% |

### By style

| style | Arm | n | Correct | nDCG@5 | Gold URL hit@5 | Authoritative share (top 5) | Identifiers in results | Identifiers in answer |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| error-string | brave | 6 | 100% | 0.75 | 0% | 43% | 100% | 100% |
| error-string | google | 6 | 100% | 0.70 | 0% | 40% | 100% | 100% |
| error-string | exa | 6 | 100% | 0.81 | 40% | 67% | 100% | 100% |
| error-string | none | 6 | 83% | — | — | — | — | 100% |
| identifier | brave | 3 | 100% | 0.81 | 100% | 67% | 100% | 100% |
| identifier | google | 3 | 100% | 0.73 | 100% | 47% | 100% | 100% |
| identifier | exa | 3 | 100% | 0.91 | 100% | 67% | 100% | 100% |
| identifier | none | 3 | 100% | — | — | — | — | 100% |
| keyword | brave | 3 | 100% | 0.84 | 100% | 47% | 100% | 100% |
| keyword | google | 3 | 100% | 0.76 | 100% | 53% | 100% | 100% |
| keyword | exa | 3 | 100% | 0.73 | 100% | 87% | 100% | 100% |
| keyword | none | 3 | 100% | — | — | — | — | 100% |
| natural-language | brave | 10 | 63% | 0.52 | 57% | 34% | 100% | 100% |
| natural-language | google | 10 | 63% | 0.41 | 43% | 46% | 100% | 100% |
| natural-language | exa | 10 | 88% | 0.72 | 86% | 82% | 100% | 100% |
| natural-language | none | 10 | 50% | — | — | — | — | 50% |
| version-pinned | brave | 2 | 100% | 0.87 | 0% | 0% | — | — |
| version-pinned | google | 2 | 100% | 0.85 | 50% | 30% | — | — |
| version-pinned | exa | 2 | 100% | 0.83 | 50% | 50% | — | — |
| version-pinned | none | 2 | 100% | — | — | — | — | — |

## Notes

- Providers return different numbers of results and different amounts of text per result (see "Mean results" and "Mean content chars"). The budgeted conditions even out that volume, but because they keep the start of each result, they work against results whose useful text sits further down the page.
- nDCG@5 scores the text each provider sent back, so a short extract can score lower than a longer copy of the same page. Per-page nDCG@5 removes that difference for pages more than one provider returned; pages only one provider returned keep that provider's format.
- Empty results get a closed-book answer, and failed searches count as not attempted.
- Grades come from an LLM judge. Spot-check `results.csv` and the per-query JSON before trusting small differences.
- Search results are a snapshot at fetch time, and gold answers can go stale; check `validAsOf` on time-sensitive queries.
