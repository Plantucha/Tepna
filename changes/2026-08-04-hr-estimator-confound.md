---
bump: patch
type: fixed
nodes: []
brief: R5-HR-TRIPLET-REFERENCE-2026-07-12-BRIEF.md
---

The "OxyDex under-reads HR by −0.36 bpm" finding is a cross-node estimator confound, not a device
property. Running the existing `o2ring-finger-validate-batch.mjs` over all 20 capture nights (252
windows, 237 PASS) shows the ring's firmware HR agrees with chest ECG to −0.027 bpm, 0.6σ — the sensor
is not the biased leg. The two nodes summarise an epoch differently: ECGDex uses `60000/mean(RR)`,
OxyDex uses `median(1 Hz rate)`, and on 1670 real 300-beat blocks that pairing differs by −0.299 bpm,
which is the size of the reported bias. Adds LEG 3 to `tools/oxy-hr-bias.mjs` to reproduce it and a
source-scan gate pinning the confound, anchored on the epoch-HR assignment. Deliberately not a numeric
gate: synthetic series do not reproduce −0.299 (symmetric +0.03, long pauses +0.54 — opposite sign), so
the mechanism within real RR is unisolated and only the confound is asserted.
