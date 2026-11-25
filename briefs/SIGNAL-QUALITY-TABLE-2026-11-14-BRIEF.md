<!--
  SIGNAL-QUALITY-TABLE-2026-11-14-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** IN-PROGRESS (the ECGDex pilot, the §7.4 spine move and the PpgDex adoption are COMPLETE; §7 rolls the table out to MotionDex, OxyDex, CPAPDex and GlucoDex) · **Created:** 2026-11-14

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

## 3b · Sidecar ledger, with values before and after

Owner question, 2026-11-14: does the table show every sidecar, and the values before and after
each one applies? The answer is now yes. The table gains a sidecar ledger, one row per sidecar
that the box can write for the node's streams.

The ledger READS its sidecar set from the registry in `tools/sidecar-census.mjs`, which the
`sidecar-census` gate already holds. The table below is a reader's summary, not a second
declaration. Two declarations of one set drift apart (Magpie, board #6195).

| name shown | file | what it tells the node |
|---|---|---|
| Signal gaps — ECG | `_ECGRUNS.txt` | spans where the ECG stream holds no valid samples |
| Signal gaps — optical | `_PPGRUNS.txt` | spans where the PPG stream holds no valid samples |
| Signal gaps — optical, 2nd stream | `_PPG2WRUNS.txt` | the same, for the second PPG stream |
| Signal gaps — motion | `_ACCRUNS.txt` | spans where the accelerometer holds no valid samples |
| Clock jumps — ECG | `_ECGSEAMS.txt` | instants where the ECG device clock stepped or resynced |
| Clock jumps — optical | `_PPGSEAMS.txt` | the same, for the PPG stream |
| Clock jumps — motion | `_ACCSEAMS.txt` | the same, for the accelerometer |
| Clock jumps — heart rate | `_HRSEAMS.txt` | the same, for the device heart-rate stream |
| Clock jumps — beat intervals | `_PPISEAMS.txt` | the same, for the device beat-interval stream |
| Radio clock log | `_RADIOCLOCK.csv` | the radio controller's own timing of each connection event, an optional second clock below the host stack |
| Ring clock log | `_RTCLOG.csv` | the O2Ring's real-time clock, read once per connect |
| Bluetooth link log | `_LINK.csv` | the host's link status for the night (one file per night, tied to no stream) |
| Ring contact log | `_OXYFRAME.txt` | the O2Ring's per-frame finger-contact flag |

The table shows the human-readable name first. The file name sits beside it in small type, so a
reader can still find the file. The names come from the registry in `tools/sidecar-census.mjs`,
which gains a `label` field for each tag.

Each ledger row has a state from a closed set:

- `read` — the node found the sidecar and applied it.
- `absent` — the box wrote no sidecar for this stream. The row says so, and it never reads as clean.
- `not-read` — the sidecar exists, but the node has no reader for it. The table shows this state
  as a defect, because a fact that the node drops is invisible otherwise.
- `not-applicable` — the sidecar cannot exist for this recording, for example a phone export
  (§3c) or `_OXYFRAME` against an ECG stream.

Each fact that a sidecar changes shows two values: the value before the sidecar applies and the
value after it applies. Examples: coverage before and after the node masks the RUNS spans, resync
count before and after the SEAMS file, and the axis rate before and after `hostAxis`. The
difference is the sidecar's effect, and the reader can see it. When the two values are equal,
the row still shows both. The equality is a measured result, not an omission.

## 3d · Clock drift overnight and per window

Owner request, 2026-11-14: the table shows each device's drift over the whole night and per
window. The reader then sees whether the clock drifted slowly or moved in sudden steps.

Drift needs a time reference, not a second clock inside the same file. The table computes drift
against the best reference the night holds, and it names that reference in the row. The
references, best first:

| reference | example | what limits it |
|---|---|---|
| radio clock log | `_RADIOCLOCK.csv` on a box night | the controller's own timing, below the host stack |
| host arrival stamps | box capture of any device, the O2Ring included | BLE jitter and link stalls |
| device clock log | the O2Ring's `_RTCLOG.csv`, one reading per connect | few anchors per night |
| another device in the same night | O2Ring pulse rate against H10 ECG heart rate | cross-correlation lag per window, so it measures the RELATIVE drift of two devices |

The O2Ring always gets a drift row. On a box night its host stamps are a reference, although its
divergence is mostly the link stalling and not the ring's oscillator (§🔒.7). The row shows that
divergence and names the cause it cannot exclude. On a vendor export with no host stamps, the
row uses another device in the same night when one exists.

The ring's clock log already exists. The box reads the ring's real-time clock every 600 s over
the live link (`capture-host/capture.py` `_OXYII_INFO_EVERY_S`, GET_INFO bytes 24 to 31) and
writes each read to `_RTCLOG.csv`. Over 2026-08-22 to 2026-11-02 the box logged 5 387 reads, and
the ring clock ran about 24 ppm fast against the host (`WEARABLE-DRIFT-DIRECT-2026-08-02-BRIEF`
§9.2). Two limits apply:

- The ring reports whole seconds. A 1 s step over one 10 min window is about 1 700 ppm, so one
  read per window cannot resolve drift inside the window. Only read pairs hours apart resolve a
  rate.
- The real-time clock is not proven to share an oscillator with the 125 Hz sample stream. A rate
  for one says nothing about the other until a measurement links them.

Owner proposal, 2026-11-14: read the ring's clock at every window start. The proposal works if
the box times the SECOND EDGE. The box polls the clock in a short burst until the seconds value
changes, and it stamps that change on the host clock. The edge instant is good to about one BLE
round trip, not 1 s. One edge per window then gives a sub-second anchor per window.

This is capture-host work in Heron's lane, and a deploy to vigil stays owner-authorized. OxyDex does not
read `_RTCLOG.csv` today, so the ledger shows it as `not-read` until the rollout reaches OxyDex.

A drift row reads `null` only when the night holds no reference at all, reason
`no-time-reference`. A host column that is the device time rounded is not a reference
(`independent` false), so the table moves to the next reference in the list.

| view | fact | source |
|---|---|---|
| night | total divergence in ms, and the rate in ppm with anchor count and span | `hostAxis` `spanPpm`, `n` |
| night | the Allan curve of the time error (§3) | `capture-host/allan.py` rules |
| per window | divergence change inside the window, in ms, and its rate in ppm | raw anchor residuals |
| per window | largest single jump inside the window, in ms | raw anchor residuals |
| events | each step with its instant and size, and each resync | `_clockResyncs`, the SEAMS sidecar |

The per-window cells read the RAW anchor residuals, never the smoothed correction. The width-21
running median in `hostAxis` smooths a sudden step across many anchors by design. `clock.js`
records that 287 of 1547 accepted axes carry a raw step that the smoothed `maxStepMs` reports
at under a tenth of its size. So the smoothed curve can show slow drift where the clock jumped.
The table shows both: `maxStepMs` (what the correction kept) and `rawMaxStepMs` (what the
columns did).

The table names three patterns, from the per-window strip:

- Slow drift: the rate stays near one value in every window, and no window holds a jump.
- Step: one window holds a jump, and the level after the jump stays shifted. A resync or a SEAMS
  row at that instant confirms it.
- Spike: one anchor jumps, and the next anchors return to the old level. This is usually a link
  stall on the host side, not a clock change. The table marks it and keeps it out of the rate.

The table names the pattern and shows the numbers. It never removes a step from the night figure
without saying so. A window without enough anchors reads `null`, reason `too-few-anchors`.

### Drift chart

The drift section also renders one chart with two stacked panels that share the night's time
axis. The reader sees the shape of the drift before reading any number.

1. Top panel, divergence: the x axis is wall-clock time (`tMs`, §🔒). The y axis is host minus
   device time in ms, relative to the first anchor.
   - Each raw anchor residual is a dot. The reader sees the BLE jitter and each spike directly.
   - The `hostAxis` correction is a line over the dots. Where the line leaves the dots, the
     smoother removed a jump.
   - A step is a vertical marker with its size. A spike is a ringed dot. A resync or a SEAMS
     row is a full-height rule.
   - An absent span from the RUNS sidecar is a shaded band, so a gap never reads as flat drift.
2. Bottom panel, per-window rate: one bar per window, in ppm, on the same windows as the
   strip. A window that reads `null` shows an empty slot with its reason, never a zero bar.

A second, small chart shows the Allan curve on log-log axes. Each point shows its term count.
The chart leaves out a point that reads `null` and marks its slot. Faint guide lines show the slopes
−1, −½, 0, +½ and +1 from `ALLAN-DEVIATION-2026-08-12-BRIEF`, so the reader can name the noise
type. The Integrator already draws a τ-curve sparkline in `integrator-render.js`; the pilot
reuses that drawing code where it fits.

Both charts badge each series, not the caption (§🎫). The chart title names the reference from
the list above. A recording with no reference shows no chart and one line: "no time reference".
A relative drift against another device carries that device's name in the title.

## 3c · Recordings without sidecars

Only the capture box writes sidecars. Many recordings come from another source, and the table
must stay honest for them.

| source | sidecars | how the node knows |
|---|---|---|
| capture box (`capture-host`) | yes, per the registry | box filename and header |
| Polar Sensor Logger phone export | none | its own stamp columns (CLAUDE.md "Capture provenance") |
| vendor app export (O2Ring, Welltory and others) | none | vendor format |
| CPAP SD card (EDF) | none | EDF header |

The node classifies the source first, from the file itself. It never guesses the source from an
absent sidecar, because a box night with a lost sidecar must read `absent`, not phone.

For a source without sidecars:

- Every sidecar row reads `not-applicable`, reason `source-writes-no-sidecars`. The table shows
  this state as neutral, never as a defect and never as clean.
- Each fact that a sidecar would change shows its BEFORE value only. The AFTER value reads
  `null`, reason `no-sidecar`. The node never copies the before value into the after cell.
- Coverage and absence come from the in-stream run-length detector (§∅), and the cell names that
  method. A run-length estimate is weaker than a box declaration, so its badge sits lower.
- Timing comes from the file's own two stamp columns when they exist. A phone export whose host
  column is the device time rounded has no second clock (`independent` false). The drift row
  then uses another device in the same night (§3d), or reads `null`, reason `no-time-reference`.
- The night summary names the source in its first cell, so a reader compares like with like.

The table rejects one proposed fact. Percent of full scale (%FS) describes a datasheet, not a
recording, and no device in the corpus publishes a full-scale accuracy. Drift belongs to the
clock, so the timing row and the Allan curve carry it, never an SD of the signal.

Rules for the Allan curve in the timing row:

- The input is the time error between two clocks, never the signal itself.
- The curve needs an evenly spaced series. A RUNS gap or a SEAMS step splits the series into
  segments, and the curve uses the longest segment. The row names that segment's span.
- Each point carries its term count `n`. A point with too few terms reads `null`, as
  `capture-host/allan.py` already does.
- The row shows the curve, never one number. The slope says whether more averaging helps.
- A stream whose `independent` flag is false has no second clock, so its curve reads `null`.

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

- [x] The ECGDex DSP emits `signalQuality` per channel with every fact in §3, from existing
      fields where they exist.
- [x] Each `null` cell carries a named reason. A gate asserts that no cell holds `0` over an
      absent fact.
- [x] The sidecar ledger lists every ECG-side sidecar in §3b with its state. A gate fails when
      a sidecar on disk reads `not-read` without a named reason.
- [x] Each fact that a sidecar changes shows its value before and after the sidecar applies.
- [x] The table shows the night drift against the best reference from §3d and names it. It
      also shows the per-window drift strip from raw residuals, and each step or spike with its instant (§3d).
- [x] The drift chart renders the divergence panel and the per-window rate panel, plus the
      Allan chart, with a badge on each series (§3d).
      *(`ECGUI.sqDriftPanels` draws the three series from the published facts and measures nothing of
      its own: the divergence panel reads `driftProfile.windows[].residFirstMs` (RAW residuals, per
      §3d), the rate panel reads `windows[].ppm` against the night value, and the Allan panel reads
      `hostAxis.stability.curve`. Each refusal prints the axis's OWN reason — no axis, the axis's
      `reason` when it refused, the rounded-stamp reason when `independent` is false, and an empty
      curve — so a panel never draws an absence as a flat line.)*
- [x] A Polar Sensor Logger ECG export renders the table with every sidecar row
      `not-applicable` and every AFTER cell `null`. A test covers this case.
      *(The DATA half reads the origin from the filename, because the two writers' ECG text is
      byte-identical, and under a vendor name all 25 ledger rows read `not-applicable` while the
      epoch cell's before and after are both named absences. The RENDER half now goes through the
      builder, because a cell the table drops is invisible to a leg that reads the object alone: the
      ledger count line reads `25 listed · 0 read · 25 not-applicable`, every drawn after value is a
      dash with its own reason, and no row claims a sidecar was read.)*
- [x] The render shows the table at the top of the existing Signal Quality section, above that
      section's first result card, with a badge in every cell.
      *(This box read "above the first result card" at creation. The owner's direction moved it: the
      table "surfaces in the existing Signal Quality section of ECGDex … Put the table at the top of
      that section" (agent board entry 6514), and the wording moved with the diff that built it. The
      two cards are `#sqTableCard` and `#sqDriftCard` in `ECGDex.src.html`, both inside
      `#qualitySection` and both above `#qualityCard`; a suite leg reads the three offsets in that
      order. Every row label, every channel cell and every ledger row carries a disc from
      `MetricRegistry.badge()` through the registry, and a leg resolves all 14 labels to a `measured`
      entry — because `badgeForLabel` FABRICATES an `experimental` disc for a label it cannot
      resolve, and that branch prints no warning.)*
- [x] The per-window strip aligns to the epochs that the HRV and staging code already use.
- [x] `tests/dex-tests.js` gains a group for the table over the committed ECGDex fixtures.
- [x] The ECGDex fixtures regenerate through `tools/regen-ecgdex-goldens.mjs`, and
      `tools/verify-fixtures.mjs` re-verifies them.
- [x] `npm run check` and `Dex-Test-Suite.html?full` pass.

## 7 · Rollout after the pilot

1. PpgDex, which has the most channels and a RUNS sidecar (DONE 2026-11-25). The node emits
   `signalQuality` over its optical and motion columns, each column holding the ten facts of §3,
   and its own 25-row §3b ledger. Four facts of the optical column stay absent under a named
   reason, because this node builds no drift walk and measures no mains ratio. The §3d drift
   panels stay out for the same reason: the node computes no drift profile at all.
2. MotionDex and OxyDex. OxyDex shows O2Ring drift against the host stamps on a box night, and
   against the H10 when the night holds one (§3d).
3. CPAPDex and GlucoDex, which do not carry `clock.js`, so their timing row reads `null`.
4. The helper now lives in the spine module `sq-table.js` (DONE 2026-11-25). The move landed
   ahead of the adopter, because PpgDex holds no quality machinery yet. Its adoption is a unit
   of its own.

## 8 · Open questions

- Does the ring's real-time clock share an oscillator with its 125 Hz sample stream? The
  second-edge read (§3d) can answer it, by comparing the two rates over one night.

- Which band edges define in-band SNR for each channel type? The pilot states ECG edges before
  it measures, as a pre-stated criterion.
- Does the per-window strip use the node's epoch or a fixed 30 s grid? The Combinator needs one
  grid across nodes.
