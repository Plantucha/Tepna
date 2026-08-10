<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [ECGDex]
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---
First probe battery for ecgdex-dsp.js — the second-largest file in the fleet (1755 mutants), which had
none at all, so every survivor was invisible to the equivalence prober.

40 families: 14 direct ones for exported leaves, and one analyze()-driven pipeline probe registered
across the 26 internal functions that have no other door.

Written against what the programme has measured rather than from scratch:
- direct families for exported leaves, because #1148 showed routing a leaf through analyze() diluted
  beatRegularity to 0 of 6 controls separated;
- the pipeline probe registered per-fn, because a family only reports on mutants inside the line
  range of the name it declares;
- contracts read from source.

The fixture is the module's own genSynthetic — seeded xorshift32, verified deterministic and
seed-sensitive, and it returns a complete record including deviceRR/deviceHR/deviceACC, so one call
feeds the waveform path and all three device-stream validators.

Two findings while building it, both caught by measurement rather than review:

1. genSynthetic injects its artifact spans at t = 88 MINUTES, so every probe shorter than 5280 s
   leaves the strap-shift/electrode-pop code and every SQI branch that exists for it unreached. Two
   long cases are included solely to get there.

2. The first validateHR family passed [{tMs, hr}] and 12 inputs collapsed to ONE distinct answer. The
   real contract is a plain numeric array indexed by second — every object failed the 30..220
   physiological filter, so the clip window emptied the series and every input produced the same
   nothing. Device rows are {tsMs, hr}, not {tMs, hr}. Both shapes now read from source; 28 inputs,
   10 distinct.

No classifications are emitted: the ecgdex sweep is still running. The battery lands first so the
probe can run the moment it finishes.
