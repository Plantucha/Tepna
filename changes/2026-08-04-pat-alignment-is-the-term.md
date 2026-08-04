<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [docs]
brief: PAT-UNDER-PERBLOCK-ALIGNMENT-2026-08-02-BRIEF.md
---
Withdraw §3c.5's signal-quality pair rule — there is no quality variation to select on — and identify the real term: the ACC alignment. §3a's negative is measuring alignment error, not absence of coupling.

**The proposed rule cannot be built.** Over **28 candidate pairs** on the six nights, every outcome-independent quality feature is near-constant while `matchRate` spans almost the whole range: ECG continuity is **100 % in every pair**, feet-per-beat 0.91–1.00, PPG continuity 92–100 %, and pooled |r| against `matchRate` is ≤ 0.22 for all of them — against a `matchRate` of **1 %–99 %**. Both detectors work everywhere; the obvious mechanism (a PPG dropout capping the statistic) would show as a feet/beat deficit and there is none.

**Scoring the same pair both ways removes §3c's confound** (the pairs whose alignment fails are all short). Pairs where the alignment cannot run score **+0**, validating the probe. Where it did run, removing it moves `matchRate` by **+53, +49, +48, +23, +27** on some pairs and **−72, −24, −13** on others, and produces **94–100 %** on four — §2's 90–96 % range, reproduced. The distribution is **bimodal**: when the raw offset lands inside the `[200, 650]` ms window coupling is near-total; when it does not it collapses. The ACC correction pulls both toward the mediocre middle §3a reported.

**So §3a's own first hypothesis was the right one** — *"either §2's pairing/alignment is better than this harness's, in which case the strict result is measuring a worse alignment, not an absence of coupling"*. There is strong R→foot coupling in this corpus, up to **100 %**.

**Zero-offset is a legitimate comparison, not another circular choice.** It is not fitted to anything: it is the a-priori model for a **box-captured** pair, where both streams are stamped by the same NTP-disciplined daemon so the offset should already be ~0. It is *not* proposed as a default — it fails badly on some pairs, so a per-pair residual (differential BLE latency) plainly exists.

**Next:** measure the per-pair offset directly instead of estimating it from ACC (`DexClock.hostAxis` already formalises the shape), then re-run both definitions with the pair rule fixed a priori. Until then no coupling verdict is quotable from §2, §3a or §3c — nor `O2RING-FRAME-SAMPLE-LOCK-FOLLOWUPS` §5.4's, whose zero-offset run now looks like the *right* model for a box capture rather than a compromise forced by the ring having no ACC.

Docs-only; no bundle, `manifestHash` or fixture is touched. Scratch probes over the shipped tool, removed and not committed.
