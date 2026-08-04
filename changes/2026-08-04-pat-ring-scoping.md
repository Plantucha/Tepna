<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: O2RING-FRAME-SAMPLE-LOCK-FOLLOWUPS-2026-08-03-BRIEF.md
---
Scope whether O2Ring finger PAT is reachable: the ring's timing and the corpus are both adequate, the coupling run is negative, and the published Verity control shows the blocker is not the ring.

**§5.1 corpus — not the constraint.** 16 pairs / 38.1 h of simultaneous **box-captured** O2Ring finger PPG + H10 ECG, largest 9.3 h. Box only: phone nights put two wearables ~3.3 s apart against ~0.2 s on box nights.

**§5.2 the ring's timing is NOT the problem.** Per-frame re-anchor corrections on the best night: median **+3.1 ms, IQR 8.0 ms**, p5–p95 ±19 ms, with only **0.0086 %** of samples corrected beyond 60 ms. Against `pat-gate.js`'s `residIQR ≤ 60 ms` that is **7.5× inside**, robust to the baseline. Anchor spacing median **126 samples** — a third independent confirmation of the 126:1 lock.

**§5.3 the ring has no accelerometer**, so `pat-matchrate-strict.mjs`'s ACC alignment can never run for an O2Ring↔H10 pair. Less fatal than it looks: those anchors correct *drift* between two independent device clocks, while a box-captured pair shares one NTP-disciplined daemon and the ring has no clock at all. What remains is a **constant** δ, which the strict statistic's leave-one-block-out centre absorbs by construction — so coupling is answerable, absolute PAT is not. The one unvalidated assumption is that δ does not drift across a night.

**§5.4 the coupling run is negative.** Zero constant offset, 9.3 h, 29 681 beats: legacy 31 % vs 19 % chance (ratio 1.62, p = 0.022), **strict 7 % vs 7 % chance (ratio 0.96, p = 0.87)** — indistinguishable from chance under the statistic that can fail. **The control exonerates the ring:** `PAT-UNDER-PERBLOCK-ALIGNMENT` §3a's six Verity nights, run *with* the real ACC alignment, score strict 5–9 % with four of six below chance. Statistically identical.

**§5.5 what actually blocks PAT** is §3a's own unresolved open item — legacy `matchRate` reads 24–42 % in that harness against 90–96 % in §2, a ~3× disagreement its author flags as blocking the coupling verdict. The legacy numbers here (31 %, chance 19 %) land in the §3a range, so this pass **reproduced the discrepancy rather than resolving it**: neither a positive nor a negative PAT result currently carries information, including this one. Recommendation recorded — reconcile the harnesses first.

**§4 resolves as a duplicate of §5.3**: the status frame's phase within its 126 samples and the constant δ are the same unknown from two directions. Irrelevant to coupling; for absolute PAT, blocked on hardware (no motion channel) rather than on analysis.

Docs-only; no bundle, `manifestHash` or fixture is touched. The coupling run used a scratch probe that was removed, not committed.
