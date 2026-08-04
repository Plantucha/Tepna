---
bump: patch
type: fixed
brief: PAT-UNDER-PERBLOCK-ALIGNMENT-2026-08-02-BRIEF.md
---

PAT `matchRate` counted R-peaks the PPG recording never spans as coupling failures, so it measured
recording overlap as much as coupling — and the two devices routinely disagree on length. A perfectly
coupled 2 h ECG paired with the 1 h PPG overlapping it scored 0.50 against `COUPLING_MIN 0.55`, failed
`goodMatch` and dropped from `go`/FEASIBLE to `maybe`/PROMISING with every other gate leg identical.
The denominator is now the beats the PPG could physically have covered; `matchRateRaw` keeps the old
value. Fixed in both copies (`pat-align.js coupleRtoFoot`, `pat-feasibility-worker.js coupledPAT`);
neither file is inlined into a bundle, so no `manifestHash` moves.
