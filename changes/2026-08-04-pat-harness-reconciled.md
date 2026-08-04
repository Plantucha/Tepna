<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [docs]
brief: PAT-UNDER-PERBLOCK-ALIGNMENT-2026-08-02-BRIEF.md
---
Reconcile the two PAT harnesses: the 24–42 % vs 90–96 % gap is **pair selection**, §3a's rule picks the worst pair on every night, and that inverts its coupling verdict.

§3a flagged its own 3× disagreement with §2 as **blocking the coupling verdict**. It is closed, its guess was right, and the consequence is larger than the guess.

**Not the port, not the alignment.** §3a's table reproduces row-for-row on all four nights checked. Both harnesses share stage-one acceptance verbatim (`PHYS_LO=200`, `PHYS_HI=650`, `LAG_SEARCH_MS=2000`) and the same `PATAlign.alignByAnchors` ACC alignment; `pat-feasibility-worker.js` has no per-block beat-fitted refit, so §2's "refit locally" describes those ACC anchors and not a second mechanism.

**Pair choice alone spans the gap.** Legacy `matchRate` over every candidate pair of the 10 largest ECG × 10 largest Verity-PPG fragments: 2026-07-20 **20–77 %**, 07-22 **0–74 %**, 07-25 **13–72 %**, 07-26 **0–72 %**. `matchRate` is **inversely related to overlap length** and §3a selects on *maximum* overlap, so it lands near the bottom of that range every night while §2 — hand-loading one short fragment at a time in `PAT Feasibility.html` — lands near the top. §3a is a lower bound and §2 an upper bound of one quantity, which is why their ratios agreed while their levels did not.

**And it inverts §3a's verdict.** Same night, same code, same surrogates, only the pair rule changed: 2026-07-20 strict **8 %/7 % ratio 1.22 → 29 %/7 % ratio 4.19**; 2026-07-26 strict **7 %/9 % ratio 0.79 → 35 %/7 % ratio 5.27**. §3a concluded there is no R→foot coupling beyond a phase-randomised train; on a better pair of the same night there plainly is, against an unchanged 7 % floor.

**What it does not license.** Selecting a pair *by* `matchRate` and then reporting `matchRate` is circular — the same self-reference §3a diagnosed in stage two, moved up a level. 4.19 is an upper bound exactly as 1.22 is a lower bound, and the best pairs are short (16–45 min, 1.3–2.6 k beats vs 12–18 k). **The finding is that `matchRate` is undefined without a pair-selection rule and neither existing rule is principled** — one arbitrary, one circular.

**Next:** select on signal quality computed independently of the statistic (continuous presence of both recordings, ECG SNR, PPG perfusion), then re-run both definitions. Until then no coupling verdict may be quoted from §2 or §3a — including §3a's negative and `O2RING-FRAME-SAMPLE-LOCK-FOLLOWUPS` §5.4's, which inherits the same rule and is now flagged in place.

Docs-only; no bundle, `manifestHash` or fixture is touched. Measured with scratch probes over the shipped tool, removed and not committed.
