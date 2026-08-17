---
bump: minor
type: added
brief: OXYDEX-PB-DETECTOR-2026-08-09-BRIEF.md
---

`detectSpO2Periodicity` — a periodic-breathing detector that actually measures periodicity, added
alongside the existing `detectOscillations` and not yet wired into it.

Four gating criteria: baseline-relative crossings of a rolling median rather than an absolute 95 %
level, cycle length inside the 40–130 s window settled in §2.1, at least `PB_MIN_CYCLES` consecutive
in-window cycles counted on **disjoint** half-cycle pairs, and the regularity of those cycle lengths.

The fourth criterion exists because the first three were measured and found insufficient: a prototype
carrying only the brief's three fired on 40/40 AR(1) ρ = 0.98 seeds, since a red series crosses its own
rolling baseline at intervals set by its correlation time. A run-length criterion is not a periodicity
criterion, and no amount of consecutive cycles fixes that.

`PB_MIN_CYCLES` is 4 where AASM's floor is 3. AASM scores central events from airflow on a PSG; this
estimator reads SpO₂ crossings from a wrist oximeter, and at 3 the aperiodic twin false-positives on
5/40 seeds because a random dip train contains a chance run of three similar gaps. At 4 that is 0/40
with true positives unchanged at 40/40 for both 0 s and ±10 s cycle jitter.

Tests are the three adversarial twins of §3.1 — periodic, aperiodic-with-identical-burden, and red
noise — with the red-noise leg run over 20 seeds and an anti-vacuity leg asserting that twin is
rejected *by regularity* rather than by producing no cycles at all, since a detector that never fires
would pass two of the three twins for free.

Provenance: `manifestHash` b8e9d679b1e8 → 979be8301f81, and `computeHash` moved — measured via
`verify-fixtures --check`, not assumed — because `oxydex-dsp.js` sits inside the compute closure even
though behaviour is unchanged. The corpus re-verification was therefore owed and was run: green, two
fixtures stamped `verifiedUnder → a07d86b79971`.
