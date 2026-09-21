---
bump: minor
type: fixed
brief: none
---

**The NSRR adapter now reads the oximeter's own validity channel.** SHHS1 ships `OX stat` — a 1 Hz
status channel sample-aligned with `SaO2`, documented by NSRR as the Nonin XPOD's "Oximetry Status" —
and nothing in the repo read it. `to1Hz`'s range guard cannot see an in-range sample the device
flagged: §∅'s in-band case, where validity must travel out-of-band. It did, and was discarded.
About a quarter of the ODI-4 the NSRR lane reported came from samples the device said not to use.

`nsrr-adapter.js edfToOxyRows` applies the §∅-conservative rule: any non-zero status ⇒ the SaO2
sample is absent, and the result carries `oxStat { present, applied, flaggedSec, inRangeFlaggedSec,
uncoveredSec }`. A record without the channel reads `present: false` — not flagged, not clean by
fiat. The values themselves are undocumented — NSRR's montage, equipment page, MOP and three sibling
datasets were read and none defines 0–3 — so no per-value semantics are invented; the code says so.

Measured on 278 SHHS1 records, paired: ODI-4 median **−0.700 events/h** (±0.23), as-shipped median
3.05 → 2.2, lower on 261/278, worst `shhs1-204801` 30.8 → 16.2. The adapter's own path agrees with
the independent masking count on **278/278**.

⚠️ That agreement check found a flaw in the 2026-09-15 measurement: `OxyDex.processNight` mutates
its input (`trimSensorWarmup` + `cleanArtifactHR` run in place, deliberately), and the validate tool
masked rows it had already handed to the DSP — so the status index was misaligned on any record the
DSP trimmed. Each arm now gets its own rows. The corrected figures reproduce the original to within
one record (flagged fraction 5.33 % → 5.42 %; median unchanged), so the finding stood and only its
instrument was wrong. `edfToOxyRows(edf, { ignoreOxStat: true })` exists for that tool's pre-fix arm
and nothing else.

18 gate assertions with a wiring decoy. SHHS-derived figures published before this change were
produced without the channel; regenerating a published preprint is an owner call and is filed as
residue rather than done here.

Fleet-Session: Magpie
