# Search benchmark: 20261112-221701-community-1112

- Created: 2026-11-12T22:17:01.558Z
- Queries: 7 (7 with gold answers) across coding, sent to every provider as written
- Arms: brave, google, exa, none (no search); search limit 10
- Models: answer `zai-org-glm-5-2` (thinking off), judge `grok-4-7`
- Spend: $1.75 (search $0.21, answers $0.45, judge $1.09), priced from recorded token usage with 220,800 cache-read tokens at the discounted rate

## Answer accuracy (queries with a gold answer)

Graded CORRECT / INCORRECT / NOT_ATTEMPTED by the judge model. Answers whose search failed count as not attempted. Answer errors are excluded from n.

| Arm | Condition | n | Correct | 95% CI | Incorrect | Not attempted | Correct when attempted | Answer errors |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| brave | native (as returned) | 7 | 28.6% | 8.2% – 64.1% | 71.4% | 0.0% | 28.6% | 0 |
| google | native (as returned) | 7 | 14.3% | 2.6% – 51.3% | 85.7% | 0.0% | 14.3% | 0 |
| exa | native (as returned) | 7 | 42.9% | 15.8% – 75.0% | 57.1% | 0.0% | 42.9% | 0 |
| none (no search) | native (as returned) | 7 | 14.3% | 2.6% – 51.3% | 85.7% | 0.0% | 14.3% | 0 |
| brave | top 5, 2k tokens | 7 | 28.6% | 8.2% – 64.1% | 71.4% | 0.0% | 28.6% | 0 |
| google | top 5, 2k tokens | 7 | 14.3% | 2.6% – 51.3% | 85.7% | 0.0% | 14.3% | 0 |
| exa | top 5, 2k tokens | 7 | 0.0% | 0.0% – 35.4% | 85.7% | 14.3% | 0.0% | 0 |
| brave | top 5, 8k tokens | 7 | 28.6% | 8.2% – 64.1% | 71.4% | 0.0% | 28.6% | 0 |
| google | top 5, 8k tokens | 7 | 14.3% | 2.6% – 51.3% | 85.7% | 0.0% | 14.3% | 0 |
| exa | top 5, 8k tokens | 7 | 28.6% | 8.2% – 64.1% | 71.4% | 0.0% | 28.6% | 0 |

## Equal-budget matrix: correct answers

Same answers as above, arranged so each column gives every provider the same number of results and the same token budget (except native). Budgets keep the start of each result and cut the rest.

| Arm | native (as returned) | top 5, 2k tokens | top 5, 8k tokens |
| --- | ---: | ---: | ---: |
| brave | 29% (n=7) | 29% (n=7) | 29% (n=7) |
| google | 14% (n=7) | 14% (n=7) | 14% (n=7) |
| exa | 43% (n=7) | 0% (n=7) | 29% (n=7) |
| none (no search) | 14% (n=7) | — | — |

## Retrieval quality (results as returned)

The judge reads the full text of each of the top 5 results. P@5 counts results it scored 2 or 3; nDCG@5 is normalised against five perfect results. Per-page nDCG@5 gives every copy of a page the best score any provider's copy of it got, so it compares the pages each provider ranked rather than the text it sent back. Errors and empty results score 0. "Answer in results" asks the judge whether the gold answer can be read from the top 5 results; "gold string" is an exact normalised match against all returned text. Gold URL hit and MRR also stop at rank 5, so every provider is scored on the same number of results.

| Arm | n | Empty | Errors | Mean results | Mean content chars | P@5 | nDCG@5 | Per-page nDCG@5 | Answer in results | Gold string in results | Gold URL hit@5 | MRR@5 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| brave | 7 | 0.0% | 0.0% | 7.4 | 12751 | 0.26 | 0.28 | 0.28 | 14.3% (n=7) | — | 42.9% (n=7) | 0.43 |
| google | 7 | 42.9% | 0.0% | 3.5 | 40640 | 0.20 | 0.16 | 0.19 | 14.3% (n=7) | — | 14.3% (n=7) | 0.14 |
| exa | 7 | 0.0% | 0.0% | 10.0 | 36453 | 0.37 | 0.32 | 0.32 | 28.6% (n=7) | — | 28.6% (n=7) | 0.29 |

Pages in more than one provider's top 5: 8 provider pairs, scored the same in 75% of them. Where the scores differed, the shorter copy scored lower in 0% of pairs.

## Speed, reliability, and cost

Latency is client-side through the Venice API, so it includes Venice and network overhead; compare arms against each other rather than against provider benchmarks. Percentiles time the final attempt; "all attempts" adds time spent on failed attempts. Neither includes the harness's own rate limiting or retry backoff. Cost per 1,000 queries uses the native condition and zai-org-glm-5-2 list pricing at run time, with no cache discount because search results differ on every request.

| Arm | Searches | p50 ms | p90 ms | p99 ms | Mean ms, all attempts | Mean attempts | Errors | Empty | Search $/1k | Mean answer prompt tokens | Answer $/1k | Total $/1k |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| brave | 7 | 1029 | 1186 | 1222 | 1054 | 1.00 | 0.0% | 0.0% | $10.00 | 3968 | $7.46 | $17.46 |
| google | 7 | 4147 | 7188 | 7975 | 4236 | 1.00 | 0.0% | 42.9% | $10.00 | 7769 | $13.51 | $23.51 |
| exa | 7 | 1626 | 2441 | 3156 | 1627 | 1.00 | 0.0% | 0.0% | $10.00 | 9862 | $15.76 | $25.76 |
| none (no search) | — | — | — | — | — | — | — | — | $0.00 | 91 | $3.39 | $3.39 |

## Paired comparisons

Each comparison uses only queries both arms have a grade for. Δ is the first arm minus the second, with a 95% paired bootstrap interval. The "Only A" and "Only B" columns are the discordant pairs behind the exact McNemar p-value. Intervals that cross 0 are not a measured difference.

| Pair (A vs B) | Condition | n | Δ correct (pp) | 95% CI (pp) | Only A correct | Only B correct | McNemar p |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| brave vs google | native (as returned) | 7 | +14.3 | -28.6 – +57.1 | 2 | 1 | 1.000 |
| brave vs exa | native (as returned) | 7 | -14.3 | -57.1 – +28.6 | 1 | 2 | 1.000 |
| brave vs none | native (as returned) | 7 | +14.3 | -28.6 – +57.1 | 2 | 1 | 1.000 |
| google vs exa | native (as returned) | 7 | -28.6 | -57.1 – +0.0 | 0 | 2 | 0.500 |
| google vs none | native (as returned) | 7 | +0.0 | -42.9 – +42.9 | 1 | 1 | 1.000 |
| exa vs none | native (as returned) | 7 | +28.6 | -28.6 – +71.4 | 3 | 1 | 0.625 |
| brave vs google | top 5, 2k tokens | 7 | +14.3 | +0.0 – +42.9 | 1 | 0 | 1.000 |
| brave vs exa | top 5, 2k tokens | 7 | +28.6 | +0.0 – +57.1 | 2 | 0 | 0.500 |
| google vs exa | top 5, 2k tokens | 7 | +14.3 | +0.0 – +42.9 | 1 | 0 | 1.000 |
| brave vs google | top 5, 8k tokens | 7 | +14.3 | -28.6 – +57.1 | 2 | 1 | 1.000 |
| brave vs exa | top 5, 8k tokens | 7 | +0.0 | -42.9 – +42.9 | 1 | 1 | 1.000 |
| google vs exa | top 5, 8k tokens | 7 | -14.3 | -57.1 – +28.6 | 1 | 2 | 1.000 |

### Retrieval nDCG@5

| Pair (A vs B) | n | Δ nDCG@5 | 95% CI |
| --- | ---: | ---: | ---: |
| brave vs google | 7 | +0.120 | +0.003 – +0.234 |
| brave vs exa | 7 | -0.046 | -0.148 – +0.076 |
| google vs exa | 7 | -0.166 | -0.219 – -0.118 |

### Retrieval per-page nDCG@5

| Pair (A vs B) | n | Δ per-page nDCG@5 | 95% CI |
| --- | ---: | ---: | ---: |
| brave vs google | 7 | +0.097 | -0.002 – +0.199 |
| brave vs exa | 7 | -0.039 | -0.132 – +0.078 |
| google vs exa | 7 | -0.136 | -0.202 – -0.072 |

### Gold URL hit@5

| Pair (A vs B) | n | Δ hit (pp) | 95% CI (pp) | Only A hit | Only B hit | McNemar p |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| brave vs google | 7 | +28.6 | +0.0 – +57.1 | 2 | 0 | 0.500 |
| brave vs exa | 7 | +14.3 | -28.6 – +57.1 | 2 | 1 | 1.000 |
| google vs exa | 7 | -14.3 | -42.9 – +0.0 | 0 | 1 | 1.000 |

## By slice (native)

| Slice | n | brave correct | google correct | exa correct | none correct | brave nDCG@5 | google nDCG@5 | exa nDCG@5 | brave no results | google no results | exa no results |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| coding | 7 | 29% | 14% | 43% | 14% | 0.28 | 0.16 | 0.32 | 0% | 43% | 0% |

No results counts searches that came back empty or failed.

## Coding

Authoritative share counts top-5 results from official docs, registries, and code hosts (plus per-query domains). Identifier coverage is case-sensitive and verbatim, so a renamed flag or misspelled API is a miss.

### By sub-slice

| sub-slice | Arm | n | Correct | nDCG@5 | Gold URL hit@5 | Authoritative share (top 5) | Identifiers in results | Identifiers in answer |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| community | brave | 7 | 29% | 0.28 | 43% | 54% | 33% | 67% |
| community | google | 7 | 14% | 0.16 | 14% | 48% | 0% | 33% |
| community | exa | 7 | 43% | 0.32 | 29% | 71% | 100% | 100% |
| community | none | 7 | 14% | — | — | — | — | 33% |

### By style

| style | Arm | n | Correct | nDCG@5 | Gold URL hit@5 | Authoritative share (top 5) | Identifiers in results | Identifiers in answer |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| error-string | brave | 2 | 0% | 0.42 | 50% | 70% | 0% | 0% |
| error-string | google | 2 | 50% | 0.44 | 50% | 45% | 0% | 0% |
| error-string | exa | 2 | 100% | 0.60 | 100% | 80% | 100% | 100% |
| error-string | none | 2 | 0% | — | — | — | — | 0% |
| natural-language | brave | 5 | 40% | 0.22 | 40% | 48% | 50% | 100% |
| natural-language | google | 5 | 0% | 0.05 | 0% | 50% | 0% | 50% |
| natural-language | exa | 5 | 20% | 0.21 | 0% | 68% | 100% | 100% |
| natural-language | none | 5 | 20% | — | — | — | — | 50% |

## Notes

- Providers return different numbers of results and different amounts of text per result (see "Mean results" and "Mean content chars"). The budgeted conditions even out that volume, but because they keep the start of each result, they work against results whose useful text sits further down the page.
- nDCG@5 scores the text each provider sent back, so a short extract can score lower than a longer copy of the same page. Per-page nDCG@5 removes that difference for pages more than one provider returned; pages only one provider returned keep that provider's format.
- Empty results get a closed-book answer, and failed searches count as not attempted.
- Grades come from an LLM judge. Spot-check `results.csv` and the per-query JSON before trusting small differences.
- Search results are a snapshot at fetch time, and gold answers can go stale; check `validAsOf` on time-sensitive queries.
