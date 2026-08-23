---
bump: minor
type: added
brief: FINISHED-WORK-IMPROVEMENTS-2026-08-20-BRIEF.md
---

FINISHED-WORK §B4: `tools/o2ring-dat-timefit.mjs` has claimed since it shipped that it "runs on
every night on disk" and "VALIDATES the 0xC0 time-push, which nothing else measures" — and nothing
invoked it. `trio-batch.mjs writeArrival` now does, recording a `datTimefit` block beside
`ringClock` in the arrival sidecar: the ring's stored `.dat` fitted against the same session's
host-stamped `_SPO2.csv`.

It branches on `converged`, never `ok`, so a boundary-pinned lag is recorded as a refusal with its
reason rather than as a measurement. The `.dat`'s RTC stamp only shortlists candidates — it is the
quantity being measured, so selecting on it would assume the answer — and the fit confirms.

Adds the pure `timefitDisagrees(lagS, reportedOffsetS, driftS)` for §B4's cross-check (what the ring
SAYS its clock is off by against what its stored data SHOWS, allowing ±1 s plus the observed drift).
It returns null rather than false when there is no readback: a night with one measurement must never
read as corroborated.

Verified on a real box night (2026-08-13): converged, lag −9 s, spo2 −10 / pulse −9, pulseErr 0.784.
