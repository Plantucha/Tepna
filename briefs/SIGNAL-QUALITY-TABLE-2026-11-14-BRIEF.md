<!--
  SIGNAL-QUALITY-TABLE-2026-11-14-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED · **Created:** 2026-11-14

# Signal-quality table — every Dex shows its sensors before its results

Owner request, 2026-11-14: every Dex shows a table of sensor quality values before it shows any
measured or calculated value. ECGDex is the pilot. The `COMBINATOR-2026-11-14-BRIEF.md` consumes
this table, so this brief lands first.

## 1 · Why

A result is only as good as the channel under it. Today each node computes quality facts, but it
scatters them across cards, export fields and prose. A reader sees a heart rate before the reader
sees that 30 % of the night was a rail or an absent span. The table puts the channel facts first,
in one shape, on every node.

## 2 · Prior work this brief builds on

| what | where |
|---|---|
| per-beat ECG SQI (kurtosis, bSQI, RR plausibility, rail) and its term means | `ecgdex-dsp.js` `computeSQI` |
| rail detection from the file's own histogram, with an `absent` state | `ecgdex-dsp.js` `ecgRails`, `quality.ecgRail` |
| absent spans out-of-band, written by the box | `_ECGRUNS.txt` / `_PPGRUNS.txt` (`PPG-ABSENCE-AS-VALUE`) |
| second-clock facts: `independent`, `ppm`, anchors, resyncs | `clock.js` `DexClock.hostAxis`, `quality.timingSource` |
| drift over averaging time | `capture-host/allan.py`, `ALLAN-DEVIATION-2026-08-12-BRIEF` |
| quality and confidence stay separate axes | `ARCHITECTURE-PRINCIPLES.md` ("Confidence ≠ quality") |
| SQI code already present | cpapdex, ecgdex, integrator, motiondex, oxydex and ppgdex `*-dsp.js` |
| ambient light as an SQI was refuted | PPGDex deep-dive §3.2 |

The table reuses these facts. It does not compute a second version of any of them.

## 3 · What the table holds

One row per input channel. One column per quality fact. Each cell is a value, a `null` with a
named reason, or a value with `n` beside it (§∅: a discontinuity refuses, reduced coverage
annotates).

| fact | definition | absent when |
|---|---|---|
| coverage | covered span ÷ recording span, plus the list of gaps with their reasons | never; zero coverage is a real value |
| rail / clipping | share of samples at the file's own rail, by run length | the file has no rail (`absent`) |
| flatline | share of time inside runs longer than the channel's own run-length limit | the channel has no run-length baseline |
| in-band SNR | power in the physiological band ÷ power outside it, in dB | the window is too short for the band |
| mains hum | power at 50 or 60 Hz and harmonics ÷ in-band power | the sample rate cannot see the mains line |
| node SQI | the node's existing composite and its named terms | the node has none |
| timing | `independent`, `timingSource`, resync count, `ppm` with anchor count and span | the stream has no second clock |
| reference error | bias, limits of agreement and MAE against a reference stream | no reference stream exists: `null`, reason `no-reference` |

The table rejects one proposed fact. Percent of full scale (%FS) describes a datasheet, not a
recording, and no device in the corpus publishes a full-scale accuracy. Drift belongs to the
clock, so the timing row and the Allan curve carry it, never an SD of the signal.

## 4 · Shape and placement

- The table has two views: a per-window strip (one cell per epoch) and a night summary row.
- The node renders the table above its first result card.
- Every cell carries an evidence badge through `MetricRegistry.badge()`.
- The export carries the table as a new field, `signalQuality`, beside `quality`. Old consumers
  ignore it, so the change is MINOR.
- A cell never shows `0` for an unmeasured fact (§∅).

## 5 · Cost

A shared helper that reaches more than one bundle is a spine change (§👥.3). It moves
`manifestHash` and `computeHash` on every carrier, and every corpus-backed fixture of those nodes
owes re-verification. The pilot therefore keeps the helper node-local in ECGDex. The helper moves
to a spine module only after a second node adopts it.

## 6 · Pilot — ECGDex

Assignee: decided on the agent board (`--kind decision`, 2026-11-14).

- [ ] The ECGDex DSP emits `signalQuality` per channel with every fact in §3, from existing
      fields where they exist.
- [ ] Each `null` cell carries a named reason. A gate asserts that no cell holds `0` over an
      absent fact.
- [ ] The render shows the table above the first result card, with a badge in every cell.
- [ ] The per-window strip aligns to the epochs that the HRV and staging code already use.
- [ ] `tests/dex-tests.js` gains a group for the table over the committed ECGDex fixtures.
- [ ] The ECGDex fixtures regenerate through `tools/regen-ecgdex-goldens.mjs`, and
      `tools/verify-fixtures.mjs` re-verifies them.
- [ ] `npm run check` and `Dex-Test-Suite.html?full` pass.

## 7 · Rollout after the pilot

1. PpgDex, which has the most channels and a RUNS sidecar.
2. MotionDex and OxyDex.
3. CPAPDex and GlucoDex, which do not carry `clock.js`, so their timing row reads `null`.
4. The helper moves to a spine module in the same PR as the second adopter.

## 8 · Open questions

- Which band edges define in-band SNR for each channel type? The pilot states ECG edges before
  it measures, as a pre-stated criterion.
- Does the per-window strip use the node's epoch or a fixed 30 s grid? The Combinator needs one
  grid across nodes.
