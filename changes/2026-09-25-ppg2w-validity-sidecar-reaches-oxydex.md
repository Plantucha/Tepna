<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [OxyDex]
brief: SAMPLE-VALIDITY-ENVELOPE-2026-09-17-BRIEF.md
---
OxyDex reads the O2Ring's `…_PPG2WRUNS.txt` validity sidecar, and a recorded blanking run now REFUSES the
waveform-SpO₂ bins it meets instead of being averaged through. The capture host has written the file since
`writers.py RUN_MIN_BY_STREAM` gained `"ppg2w": T_STUCK` and no JS read it — the third row of
SAMPLE-VALIDITY-ENVELOPE §3.2, the same shape as the Verity `_PPGRUNS` fix. `parsePPG2W` takes an optional
`runsText` last, maps each span to wall time, and `spo2WaveformTrend` returns those bins as `null` with the
reason `blanking-run`, excluded from the OLS self-calibration so a ratio of two nothings cannot calibrate
the rest of the night. A run intersecting a bin refuses it (not containment — every run §∅ recorded is
shorter than a bin), a run straddling a boundary refuses both, a bin inside a frozen stretch is reported
even though it contributes no points at all, and a span that cannot be placed in time is counted
(`spansUnmapped`) rather than discarded. The summary carries `binsRefusedBlanking` beside the value, zero on
a clean night, and the shortfall reason names blanking rather than borrowing "too little paired data".
Spans are resolved against each row's SOURCE data-row index, because the writer's `first_index` counts rows
it wrote while the parser's array counts rows it kept. Export-inert in value: all four OxyDex equivalence
legs are byte-identical against the real corpus and the golden regen moved only `manifestHash`/`computeHash`
stamps. The `capture-filename suffix parity` gate also learned the writer's own `<base>.txt` →
`<base>RUNS.txt` derivation, which no literal in `writers.py` spells out.
