<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [OxyDex]
brief: O2RING-FRAME-SAMPLE-LOCK-FOLLOWUPS-2026-08-03-BRIEF.md
---
`capture.predict_step_split` — the followups §2 model of the ring's duration-step quantization. It predicts the shape, and the level only to within ~2×.

The ring's counter reads `floor(t / ring + phase)`, so between two polls it advances by 1 plus whichever way the fractional phase wrapped. With the phase equidistributed (it sweeps ~22 full cycles a night) and `eps = (delta − ring) / ring`: **`n(step=2)/N = E[eps+]`** and **`n(step=0)/N = E[eps−]`**.

**Right:** the step alphabet ({0,1,2}, matching the corpus), the sign (a poll shorter than the ring second slips the phase backwards, so 0s outnumber 2s — 180 vs 159), and the scale. **Wrong: the level**, by a stable **1.85×** (IQR 1.46–2.21) over 66 clean sessions. So §2 as posed is *not* achieved — this is a bound, not a predictor.

⚠️ **The identity is not evidence.** `n0 − n2 = N(1 − mean step)` follows from `mean = (n1 + 2·n2)/N` and `N = n0+n1+n2` by algebra — it holds for any data with steps in {0,1,2}. A first pass mistook its agreement (predicted 22, observed 21) for a confirmation.

**Why it over-predicts:** `E[eps+]` is convex, so noise on the measured interval can only inflate it. The sidecar records **host arrival** times while the ring samples its counter when it builds the reply, so the measured interval carries BLE delivery jitter the ring never saw; simulation puts 1.85× at plausible ratios (~5 ms true poll jitter with ~8 ms delivery). Not refuted by the near-zero correlation with total arrival jitter (r = +0.06) — the inflation depends on the delivery/poll *ratio*, roughly constant across one daemon, not the total. Also **not confirmable from this data**: nothing records when the poll was issued. One extra column would settle it — capture-side, like §1.

Gated four ways with the bound stated in the function's own docstring: pure drift gives backward wraps only; zero-mean jitter moves both counts and leaves their difference alone; **noise on the input inflates both predictions** (the convexity that explains the 1.85×, asserted so that scaling the output to close the gap is visibly a fudge — the defect is in the input, not the formula); and no usable input returns NaN rather than a guess. Mutation-verified: collapsing the sign split fails the drift assertion.
