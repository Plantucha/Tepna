<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [docs]
brief: R5-HR-TRIPLET-REFERENCE-2026-07-12-BRIEF.md
---

Correct a false claim in a published preprint. `papers/sigma-no-reference.html` Limitations (ix)
stated the O2Ring "under-reads by −0.269 bpm" as a measured device bias. It is an **estimator
confound**, established the same day by `changes/2026-08-04-hr-estimator-confound.md` (#857), which
updated the brief and tools but not the paper.

The corrected (ix): the two nodes summarise an epoch differently — ECGDex `60000/mean(RR)` against
OxyDex `median(1 Hz rate)` — and one real series through both statistics, no device involved, gives
−0.299 bpm over 1,670 300-beat blocks, so the confound is the size of the finding. Measured directly
against the ring's own pleth over 20 nights and 237 windows, the firmware HR is statistically
indistinguishable from chest ECG (−0.027 bpm, 0.6 σ). The −0.299 mechanism is not isolated (synthetic
series give +0.03 / +0.54 / −0.03), which is itself why it cannot be attributed to a device. No
per-device HR bias may be read off cross-node epoch HR until the nodes agree on one statistic.

The limitation is stronger for it: the hat's blindness to bias is no longer merely structural, because
there is at present no validated bias figure for any corner to be blind to. The §1 identity and the
variance-only statement are unchanged and remain correct.

Also corrected: the R5 brief's own description of what (ix) contains, which still described the
withdrawn wording.
