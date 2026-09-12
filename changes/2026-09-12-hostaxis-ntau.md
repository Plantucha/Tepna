---
bump: patch
type: fixed
nodes: [PpgDex, ECGDex]
brief: ALLAN-STABILITY-GAPS-2026-09-07-BRIEF.md
---

`hostAxis.stability` published `slopeSE` without the n it was computed over.

`clock.js`'s Allan classifier has always carried `nTau` — the number of τ points the log-log slope was
fitted over — on both of its return paths, and the published `stability` object forwarded `slope`,
`slopeSE`, `noise`, `candidates` and `meaning` and dropped it. So no consumer could reach it, and a node
writing `nTau: stability.nTau` got a permanent null: the same defect the sibling fix corrected for
`tau0`/`noiseType`, one field over. PpgDex's own detector-stability block already published `nTau`; only
the spine's host-axis block did not.

It matters because a standard error is uninterpretable without its n — the SE divides by k−2, so a tight
SE over 3 τ points and one over 12 are different claims, and nothing else published separates them.

`taus` is NOT a substitute and the gate now pins that: `taus` counts the curve, `nTau` counts the points
the fit used, and the fit keeps only those with `adev > 0`. A τ whose adev is exactly zero is dropped
from the fit and still counted in `taus`, so reading `taus` as the SE's n overstates it. Pinned by a
planted period-8 phase on an exact 1 s grid, where the curve reaches 7 τ and the fit uses 3.

The field is forwarded on the spine and exported by both host-axis consumers (PpgDex, ECGDex). Additive
on every surface; no existing key changes.
