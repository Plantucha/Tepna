<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: DEEP-AUDIT-II-2026-07-18-BRIEF.md
---
`analysis-stats.js roc()` stepped through tied scores **one point at a time**, drawing a staircase through each tied group. The area therefore depended on whether positives or negatives happened to be ordered first *within* the tie — and `sort` is stable, so that is simply input order. The papers layer feeds `roc()` from workers, which made the published AUC **run-to-run nondeterministic**, and it falsified `hrv-confound-analysis.js`'s own order-invariance comment.

The damage was not marginal. On the same six observations, permuting **only the tied labels**:

| ordering | reported AUC | reads as |
|---|---|---|
| A | **1.0000** | perfect discrimination |
| B | **0.5556** | barely above chance |
| truth | **0.7778** | — |

Neither endpoint was correct. Worse, a set of four *identical* scores with mixed labels — data containing no discriminating information at all — reported **AUC 1.0**.

Advancing `tp`/`fp` across the whole tied block and drawing a single trapezoid over it is the diagonal through the tie, which is exactly the half-credit Mann–Whitney assigns. So `roc().auc` now equals `mannWhitneyAUC()` identically — the gate the audit prescribes, and a relationship no ordering can satisfy by accident.

6 new assertions. Every pre-existing `roc` case used **distinct** scores, which is precisely why this survived — the tie path had no coverage at all. The identity is also asserted on the no-tie case, so a tie-grouping bug cannot "fix" ties by breaking the clean path.

Mutation-verified: restoring per-point stepping reproduces exactly 1.0000, 0.5556, and the all-tied 1.0. No app bundle touched — `analysis-stats.js` reaches the analysis tools only; 6 rebuilt, GATE A/B untouched.
