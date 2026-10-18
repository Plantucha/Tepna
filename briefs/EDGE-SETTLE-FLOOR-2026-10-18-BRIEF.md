<!--
  EDGE-SETTLE-FLOOR-2026-10-18-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
  Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
  project root, or http://www.apache.org/licenses/LICENSE-2.0
-->
**Status:** PROPOSED · **Created:** 2026-10-18

# Edge-settle floor: one fixed settle time per sensor, one common start for fusion

## 1 · The ruling

The owner ruled on 2026-10-17 (EDT). A sensor's signal is not clean at the start and the end of a session. The suite starts its compute when the last sensor has settled, and stops when the first sensor stops being clean. The owner agreed to the plan in §3 with "i agree, write it up".

Rule 0: `session start end transient settle trim common overlap window across sensors` → `docs/EVENT-LEXICON.md`, `OXYDEX-PB-DETECTOR-2026-08-09-BRIEF.md`, `WEARABLE-SYNC-2026-07-31-BRIEF.md`, `capture-host/nightqc.py`, `PPGDEX-ALGORITHM-DEEP-DIVE-2026-07-21-BRIEF.md` §1.5. No prior work sets a settle floor for every node.

## 2 · What exists today

| node | edge handling on main, 2026-10-18 |
|---|---|
| OxyDex | `trimSensorWarmup` trims a frozen placeholder run at each edge. It is adaptive; 0, 8 and 25 s are seen. |
| ECGDex | Only the HR correlation skips the first 60 s (`ecgdex-dsp.js`, the electrode-settling lead-in). Every metric reads the whole record. |
| PpgDex | Nothing. Polar advises to ignore the first seconds, because the autogain steps at the start. |
| fusion | `tools/trio-batch.mjs` and `tools/pat-three-corner.mjs` cut the legs to their three-way overlap. They do not remove settling. |

## 3 · The measurement

`tools/edge-settle.mjs` (#3620) measures the settle time per sensor and edge from the trio node exports. A bin is 10 s. The settle point is the first or the last 60 s run of clean bins. An edge over 600 s is late wear, not settling: the tool counts it and leaves it out of the distribution.

The population is 147 nights in `uploads/trio`, run on 2026-10-18. Values are seconds.

| sensor | edge | n | p50 | p90 | p95 | max | late wear |
|---|---|---|---|---|---|---|---|
| ECG | start | 95 | 0 | 110 | 140 | 520 | 0 |
| ECG | end | 86 | 10 | 170 | 210 | 300 | 9 |
| PPG | start | 90 | 30 | 240 | 280 | 390 | 9 |
| PPG | end | 89 | 30 | 230 | 260 | 460 | 10 |
| O2Ring | start | 147 | 0 | 30 | 60 | 110 | 0 |
| O2Ring | end | 146 | 0 | 10 | 40 | 220 | 1 |

| device start spread, 104 multi-sensor nights | seconds |
|---|---|
| p50 | 127 |
| p90 | 1447 |
| max | 9501 |

The device start spread is larger than the settle time. So the common start must come from the start stamps of each night. The settle time itself can be a constant.

## 4 · The design

### 4.1 · A fixed constant per sensor, from p95

| sensor | start floor | end floor |
|---|---|---|
| ECG (H10) | 140 s | 210 s |
| PPG (Verity Sense) | 280 s | 260 s |
| O2Ring | 60 s | 40 s |

Reasons:

1. **Fixed, not per night.** A cut that each night measures on its own signal lets the data choose the data. Clean nights then keep more than noisy nights, and the rule alone cannot reproduce a result. A fixed rule gives the same cut for the same input.
2. **Per sensor, not one 300 s cut.** The sensors settle at different speeds. A single 300 s cut removes clean O2Ring and ECG data and buys nothing. The common start, not the cut length, aligns the windows (§4.2).
3. **p95, not the maximum.** The maximum (PPG 390 s, ECG 520 s) would remove minutes on every other night. The per-beat quality gate in each node already removes bad beats in the remaining 5 %.

### 4.2 · One common window in fusion

The owner asked whether different start times make the three-cornered hat lopsided. They do only if each leg starts its 5-min windows at its own point. So fusion uses one window for every leg:

- **Common start** = MAX over the sensors present of (`t0Ms` + start floor).
- **Common end** = MIN over the sensors present of (end `tMs` − end floor).
- Every leg starts its 5-min epoch grid at the common start.

A node opened alone has one sensor. It starts at its own `t0Ms` + start floor.

### 4.3 · The trimmed edge is coverage, not a seam

The owner's ruling of 2026-09-17 applies: a discontinuity refuses, a reduced coverage annotates. The floor reduces coverage. Each export keeps the full recording span. It adds the computed span and the floor that set it beside the metrics. It never writes a 0 or a null into the trimmed samples. The captured bytes stay as they are.

### 4.4 · The caveat

The floors come from the same nights that the hat analyses. This is acceptable for two reasons. The floor is a data-quality rule, not the quantity the hat tests. It is also the same constant on every night, so it cannot favour one result.

## 5 · Done when

- [ ] 1. One shared constant table holds the six floors. A comment names the source: this brief, 2026-10-18 and 147 nights. `kernel-constants.js` is the candidate, because all 8 bundles carry it (`CLAUDE.md` §👥.3).
- [ ] 2. ECGDex, PpgDex and OxyDex compute from `t0Ms` + start floor to end − end floor. OxyDex keeps `trimSensorWarmup`; the floor applies after it.
- [ ] 3. Each export carries `recording.computeStartMs`, `recording.computeEndMs` and the floor values used. `recording.startEpochMs` stays the first valid sample.
- [ ] 4. Fusion starts every leg's epoch grid at the common start of §4.2. Fusion here is `tools/trio-batch.mjs`, the Integrator and `tools/pat-three-corner.mjs`.
- [ ] 5. A test plants a 200 s artefact at the start of each sensor. Each metric must not change with and without the artefact.
- [ ] 6. A test plants three legs with different starts. All three epoch grids must start at the same `tMs`.
- [ ] 7. Its `tools/regen-<node>-goldens.mjs` regenerates each moved fixture. `tools/verify-fixtures.mjs` re-verifies the corpus fixtures.
- [ ] 8. `tools/edge-settle.mjs` runs in `npm run check` as a tripwire. A new device or firmware that settles slower turns its verdict red. The next unit then measures the floors again.
- [ ] 9. `npm run check` exits 0. `Dex-Test-Suite.html?full` is all green.

## 6 · Open

1. **GlucoDex, CPAPDex, MotionDex and HRVDex** are not in the measured population. They need their own measurement before they get a floor.
2. **The release bump.** A moved fixture output is a PATCH. A changed metric identity would be a MAJOR. This brief changes the span of each metric, not its identity, so the expected bump is PATCH.
