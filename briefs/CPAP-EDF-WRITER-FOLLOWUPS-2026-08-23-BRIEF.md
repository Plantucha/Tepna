<!--
  CPAP-EDF-WRITER-FOLLOWUPS-2026-08-23-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** IN-PROGRESS — 2026-08-23 · **Created:** 2026-08-23

# CPAP-EDF-WRITER follow-ups — what the flow-scale pin surfaced

The live BLE→BRP.edf writer (`cpap_edf_writer.py`, #1683) shipped **quarantined**: the StreamData
`PatientFlow` unit was unverified, so files landed under `PENDING/` with `flow_scale_verified` False.
On 2026-08-23 the owner ran a **~5-minute mask-on daytime session** while the live stream captured to a
quarantined EDF; the next SD-card harvest gave the device's own BRP.edf for the same session, and the two
were compared sample-by-sample (`/srv/tepna/probe/cpap_pin_compare.py`, aligned by cross-correlation).
Three things came out of five minutes of breathing.

## 1. FLOW UNIT PINNED: L/s (identity) — DONE, this PR

Scale factor (live/SD) = **0.924**, flow ranges live ±0.94 vs SD ±0.94 L/s. The device streams flow in
**L/s**, definitively NOT L/min (which would be ~60×). The EdfSink's identity `flow_to_lps` default is
CORRECT; the `"L/min"` bus label in `BRP_CHANNELS` was wrong. So `flow_scale_verified` now DEFAULTS TRUE
(`capture._build_cpap_controller`, overridable to False) and files land in the committed root, not PENDING.

## 2. CLOCK: stamp LOCAL CIVIL, not device-UTC — DONE, this PR

The pin's cross-correlation aligned at **exactly 698 s = a clean 4 h offset, no sub-second skew**: the
live StreamData stamp is **UTC** (`18:47:42Z`), while the SD card and OSCAR use **local civil**
(`14:36:04` EDT). The EdfSink was writing the UTC components verbatim, mis-dating every EDF by the UTC
offset. `_start_components` now resolves a ZONED stamp (`Z` / `±HH:MM`) to the box's local civil time
(an unzoned stamp is already floating local civil per the Clock Contract §1, taken verbatim); the
resolution is recorded in the daemon log for provenance. This is the house Clock Contract, not just the
SD convention — device-UTC was the deviation.

## 3. STREAMED-VS-LOGGED DIVERGENCE — MEASURED ONCE (n=1), NOT a device property yet

Beyond the unit and the clock, the live BLE stream and the SD recording are **not byte-identical**:
Pearson **r = 0.960**, RMSE = 0.096 L/s, regression scale **0.924** (not 1.000) over the 5-minute overlap.
This is a real difference between the streamed and logged representations — but it is **one session,
5-minute overlap**. It MUST NOT be stated as "the AS11 streams at 92.4 % of logged scale" until replicated.
Open questions for replication: is the 0.924 **flow-dependent** (amplitude/rate), an **alignment residual**
(sub-sample drift over longer windows), or **decimation/filtering** in the live path? **Do NOT fold a
1/0.924 correction into the sink** — divergence is recorded and characterised, never laundered into the data.

## 4. The comparator becomes a permanent CPAPDex surface (tepna-99)

`cpap_pin_compare.py` is the reference implementation for the CPAPDex streamed-vs-logged comparator
(assigned to tepna-99). Design requirement this pin taught us: the cross-correlation **silently absorbed
the 4 h offset** — it found the overlap regardless. The shipped comparator MUST **report the alignment
offset it needed as a first-class, badged output**: a 4 h offset is a *finding* (a clock bug), not a
nuisance parameter to optimise away. The streamed-vs-logged scale/r become the surface's headline tracked
series, gaining statistical weight as sessions accumulate.

## Done-when

- [x] flow unit pinned (L/s), `flow_scale_verified` default flipped, files leave PENDING.
- [x] EDF start stamped in local civil; conversion recorded in provenance; tests pin both zoned→local and
  unzoned→verbatim (TZ-guarded so they are deterministic in CI).
- [ ] the 0.924/r0.96 divergence replicated across ≥ several sessions and attributed
  (flow-dependent / alignment / decimation) — then, and only then, stated as a device property.
- [ ] CPAPDex comparator surface built with the alignment-offset badged output (tepna-99).

Superseded/related: the single CPAP-BLE-capture roadmap brief carries the north-star sequence; this brief
is the pin/clock leg of it.
