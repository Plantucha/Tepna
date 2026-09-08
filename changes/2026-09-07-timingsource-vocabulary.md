---
bump: minor
type: fixed
nodes: [Integrator, ECGDex, PpgDex]
brief: OXYDEX-PB-DETECTOR-FOLLOWUPS-2026-08-17-BRIEF.md
---

The Integrator's three-cornered-hat tested `timingSource !== 'device' && !== 'device+host'` — a
CLOSED vocabulary written as an open one. OxyDex has emitted `'device+host-verified'` since #1643,
so that corner has been silently marked `pseudo` ever since, downgrading the hat to a heuristic
badge with no red and no warning because the failure direction is the conservative-looking one.

Replaced by an enumerated `TIMING_SOURCE_VOCABULARY` in which every value carries an explicit
`timed` decision and a stated reason, with unknown values FAIL-CLOSED (never spent as a clock), and
a gate that scans the emitters and reds on any value lacking an entry — so adding a value without
deciding what it means is no longer possible.

The unit was assigned as the radio-clock consumer (RADIO-CLOCK-SIDECAR §4, unlanded); this is the
half that stands on its own. `dex-ingest.js` also gains `RADIOCLOCK` to its sidecar-exclusion regex, before the file exists:
without it a `*_RADIOCLOCK.csv` beside `_ECG.txt`/`_PPG.txt` is queued as a PRIMARY waveform in
BOTH nodes, the same defect `_PMDARRIVAL` produced a generation earlier.
