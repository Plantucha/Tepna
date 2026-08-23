---
bump: minor
type: added
brief: EXTERNAL-METHODS-SURVEY-2026-08-20-BRIEF.md
---

`tools/nearest-advocate.mjs` — event-based time-delay estimation (Schranz et al. 2024, *EURASIP JASP*,
DOI 10.1186/s13634-024-01143-1), the method `EXTERNAL-METHODS-SURVEY` §2 identified for the case where
cross-correlation is known to fail. Prerequisite for §2's measurement against the buzz-fiducial night.

**Ships with the two guards the failure it replaces lacked**: a shuffled-interval **null** (same event
count and rate, shared structure destroyed) and **boundary detection** — `aperiodic-offset.mjs` failed
by returning a confident argmax whose peak rode the search edge (3850 ms at ±4 s → 9000 at ±9 s). An
`ok:false` result carries **no** shift a caller could mistake for an estimate.

Selftest: planted-shift recovery under jitter and 20 % missing events, sign asserted, independent
series refused (z 0.60), out-of-window shift refused rather than clamped, width-stability at ±2/±4/±6 s,
determinism.
