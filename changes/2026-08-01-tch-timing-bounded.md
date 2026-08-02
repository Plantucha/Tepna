<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [Integrator]
brief: CROSS-DEVICE-DRIFT-AND-CLOSURE-2026-08-01-BRIEF.md
---
Adds §2.6 — the two steps past closure that three devices allow, both run through the suite's **own** `integrator-tch.js` rather than a hand-rolled decomposition.

**Normalisation** is lossless where closure holds, and it is also what makes pairwise offsets *shaped* for TCH (`threeCorneredHat` wants three per-device series, not three differences). On 2026-07-27, ECG as reference: Verity **+97 ppm**, O2Ring **+71 ppm**. Relative only — no wearable triple yields an absolute rate; the capture host could, at 0.008 ppm.

**TCH must be detrended first.** It decomposes *noise*; a 100 ppm drift is a trend, and fed raw the repo's solver returns `ok:false — negative variance; no non-negative correlated fit ≤ rhoMax` on both closing nights. Detrended, exactly **one night decomposes cleanly** (2026-07-27, classic, ρ = 0): σ ECG **128 ms**, Verity **29 ms**, O2Ring **81 ms**. Everywhere else needs ρ = 0.45–0.79 — the solver can only fit by assuming half to four-fifths of the residual is shared.

**And those numbers are not clock jitter.** Both ECG-containing pairs carry pulse arrival time, so TCH assigns their common variance to the ECG — and per-block PAT IQR here is 43–112 ms, the same order. That is the tool working: its assumption is independent per-device noise, and beat-derived offsets cannot satisfy it because the pulse is common to all three devices by construction. A well-posed timing TCH needs three independent timing paths — three IMUs, or a host reference. This hardware has two IMUs.

Also records (§3.4) that `inverseVarianceWeights` is already exported and `fitClockOffsetPooled` weights channels equally. Not wired on this evidence, which needs a σ that is not physiology — but the two halves have been sitting one file apart without meeting.
