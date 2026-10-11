<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-10-11 (v2 PASSES the re-stated criterion: recall within the top 1 % of the pair
space is **0.833** on the held-out half against a floor of 0.5. v1's SHORTFALL at recall@50 = 0.167 is
kept in §4 because the reason it failed — a k chosen without the pair count — is the finding) ·
**Created:** 2026-10-11 ·
**Extends:** `DONE-WHEN-CROSS-BRIEF-2026-09-23-BRIEF.md` (the negative result this is the fourth shape of)

# A text-network gap detector over the briefs

## 1 · The question

Two briefs decide one question in different vocabulary and never reference each other. Nobody notices,
because noticing requires having read both. `DOCS-INDEX.md` lists them; it does not relate them.

## 2 · What was built

`tools/brief-gaps.mjs`. A **GAP** is a pair of briefs that is

1. close in embedding space (cosine over the mean of a brief's cached chunk vectors, bge-m3, 1024-d),
2. **not** connected by a citation path of length ≤ 2, and
3. **not** already joined by a `Supersedes` / `Superseded-by` line.

Output is a ranked reading list — pair, similarity, strongest shared terms (local TF-IDF), and both
status lines — plus one `tepna.verdict/1`, gate `brief-gaps`, scope internal.

**Adjacency is not equivalence.** The tool never writes a supersession, never closes a row, and never
edits a brief. Its verdict decides one thing only: whether the ranking is good enough to be worth a
person's reading time.

Inputs, measured 2026-10-11: **544 briefs** in the chunk index (10,475 chunks of the index's 60,559),
**147,696** candidate pairs, **36** hand-marked supersession pairs, and a citation graph read from
brief *filenames* in prose — there are no markdown links between briefs at all.

The index is ~768 MB and is **streamed**; only one mean vector per brief is retained. Peak RSS of a
full run: **222 MB**.

## 3 · What the negative result required, and how each item is met

`DONE-WHEN-CROSS-BRIEF` §7 pre-states what a fourth attempt owes.

| §7 item | how this shape answers it |
|---|---|
| 1 · do not key on a shared literal (here a shared number means citation) | the signal is a 1024-d vector; no literal is compared |
| 2 · **plant both directions** — "same change, different words" is the case a lexical shape cannot see | `--selftest` plants a disjoint-vocabulary pair and asserts it is FOUND, beside a shared-vocabulary pair |
| 3 · verify each plant was SEEN | each plant asserts a positive observation, and one case asserts the plants are not a vacuous pass |
| 4 · the remaining honest shape is **social, not analytic** | **unchallenged.** This is a reading aid, not a closure mechanism; §7.4's CLAUDE.md change is still the real fix |

## 4 · The benchmark, and why it SHORTFALLS

Pre-stated: hide the 36 hand-marked pairs from the citation graph and the supersede set, then measure
recall@k. Threshold chosen on one half, reported on both, because a threshold fitted to the pairs it
judges is `UNKNOWN` by the verdict contract.

**Result: recall@50 = 0.167 on the held-out half (0.111 over all 36), against a floor of 0.5 → SHORTFALL.**

The diagnostic is the useful part. The marked pairs are **not** noise — their median rank is the top
**1.20 %** of all pairs, and 28 of 36 are in the top 5,000:

| k | recall | k as a share of the 147,696 pairs |
|---|---|---|
| 50 | 0.028 | 0.034 % |
| 100 | 0.111 | 0.068 % |
| 500 | 0.278 | 0.339 % |
| 1,000 | 0.361 | 0.677 % |
| 1,477 | 0.417 | 1.000 % |
| **5,000** | **0.778** | 3.385 % |
| 10,000 | 0.806 | 6.771 % |

**recall@50 ≥ 0.5 was unreachable by construction.** 50 pairs is the top 0.034 % of the space; the
marked pairs' median sits at 1.2 %. The criterion was set without the pair count in hand — the same
shape of error as sizing a sweep from a stem count. Recall saturates at ~0.78 by k = 5,000, so the
ranking carries real signal and the acceptance number was simply in the wrong decade.

⚠️ **The threshold is doing almost no work, and that is a finding too.** The similarity distribution
is compressed high — min **0.494**, median **0.789**, p10 0.861, p1 0.912, max 0.977 — so "above a
threshold" admits nearly every pair (145,068 of 147,696 at 0.5). Mean-pooling a whole brief washes out
topic: every brief shares the house vocabulary, the SPDX header and a status line. **The RANKING is
the entire signal; the threshold is a formality.** A fifth shape should pool over the brief's
*decision* text rather than the whole file, or compare chunk-maxima instead of means.

## 5 · What this owes next

1. **A criterion stated with the pair count in hand** — recall@k for k as a *share* of the space, or
   precision@k on a reading list of a stated length. Not a re-run of this one at a bigger k, which
   would be a threshold fitted to its own answers.
2. A pooling that is not the whole-file mean (§4's compression is measured, not assumed).
3. §7.4 stands: the honest fix for the class is social.

## 6 · Done-when

- [ ] A criterion pre-stated against the measured pair count, and met.
- [x] The detector exists, streams the index under the memory rule, and plants both directions.
- [x] The benchmark is pre-stated, held out, and reported on both halves.
- [x] No automatic closure or supersession write exists in the tool.

## 7 · v2 — the criterion re-stated as a SHARE, and the pooling changed

**Owner ruling 2026-10-11**, after v1's SHORTFALL: state the criterion as a share of the pair space,
and pool the decision text rather than whole-file means.

**Criterion (pre-stated, ahead of the run):** recall within the **top 1 %** of the ranking ≥ 0.5. The
share is computed *from* the space — 1,488 pairs of 148,785 — which is exactly what v1's fixed k = 50
was not. **No threshold is fitted:** with the criterion expressed as a share, the threshold only has to
avoid truncating the top 1 %, and it plays no part in the verdict.

**Pooling:** the mean of the **three strongest chunk-pair similarities** between two briefs
(`chunk-top3`), chosen on the fit half and reported on the held-out half.

| pooling | held-out recall within top 1 % |
|---|---|
| mean of a brief's chunks (v1) | 0.444 |
| strongest chunk pair | 0.833 |
| **mean of the top 3 chunk pairs (v2)** | **0.833** |

**Result: PASS — 15 of 18 held-out pairs inside the top 1 %** (fit 15/18, all 30/36). For reference at
v1's fixed k, the same ranking gives recall@50 = 0.444 and recall@100 = 0.5 — the ranking improved and
the *criterion* was the larger of the two defects.

⚠️ **The owner's decision-text pooling could not be built, and the obstacle is the index, not effort.**
The cached index records `{ file, h, vecs }` and nothing else — **no chunk text and no offsets** — so
there is no way to say which chunk holds the status line or a ruling section, and embedding an
extracted passage would require a model call. Chunk-level pooling is the one option available from
cached data. Unblocking the asked-for shape needs an index that records chunk offsets.

Cost of a full run: **1 m 50 s wall, 368 MB peak RSS** (the chunk-pair comparison is quadratic in
chunks as well as briefs). The reading list is the top 1 %, not every pair above a threshold.

§7.4 of the negative result still stands: the honest fix for the class is social. This remains a
reading aid that writes nothing.
