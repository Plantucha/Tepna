---
bump: patch
type: fixed
nodes: [PpgDex]
brief: ALLAN-STABILITY-GAPS-2026-09-07-BRIEF.md
---

PpgDex exported `hostAxis.stability.tau0` and `.noiseType` as permanent null.

The export block read those two names back off the spine's stability object, which publishes `tau0Sec`
and `noise` — so neither key existed at the source and both were null on every recording ever exported.
A fabricated absence, and one that reads exactly like "this pair had no second clock", which is the one
thing `stability: null` is supposed to mean.

The exported NAMES are kept for consumers that already read them; only the source keys are corrected.
Four fields are added alongside — `slopeSE`, `candidates`, `optimalTauSec`, `atLongestPpm` — each
verified published on the spine object first. `nTau` is deliberately not exported: the classifier
computes it but `hostAxis.stability` does not forward it, so reading it would re-create this defect one
field over.
