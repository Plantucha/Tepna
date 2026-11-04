<!--
  RADIO-DELAY-FLOOR-2026-11-03-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
  Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
  project root, or http://www.apache.org/licenses/LICENSE-2.0
-->
**Status:** PROPOSED (core BUILT, remainder corpus-blocked — verified 2026-11-03: `anchorFloor` ships and eleven suite legs pass. The rig holds no sidecar, so the box owes §5. **RE-TRIAGED 2026-11-04 (Heron, box read-only; rule 0: "solid night cowear probe stage lab O2Ring presence trigger radio delay floor vigil coexistence brief status"): §5'S PRECONDITION IS MET ON THE BOX, so the arm is SCHEDULABLE and no longer corpus-blocked.** `/srv/tepna/captures` holds fourteen `*RADIOCLOCK*` sidecars over four nights — 2026-10-30, 2026-10-31, 2026-11-01 and 2026-11-03 — where this brief's own §5 expected six. **CORRECTED 2026-11-04 (Heron, rig measurement): THE RIG HOLDS ELEVEN OF THEM TOO, so the arm needs no box session.** `find uploads/` returns nothing because `uploads/vigil-archive` is a symlink to the NAS, and `find -L` finds eleven sidecars over 2026-10-30, 2026-10-31 and 2026-11-01, each one older than this brief. `docs/CORPUS-LOCATIONS.md` already names that path canonical for a rig reader. My earlier sentence that the rig holds none repeated a symlink-blind find, and this withdraws it. No `*PAT*` file exists beside them, so PAT still comes from the beat path at analysis time. What §5 now owes is the analysis itself, which a box session can run read-only, and the second box still waits on §5 earning a band. **MEASURED 2026-11-04 (Heron, §5a): the floor's own anchor is the BLE controller clock, and moving the map onto the host stamp holds each device's rate across nights, so only the beat half of §5 stays owed.**) · **Created:** 2026-11-03

# The radio delay has a floor, and the band reads its tail

## 1 · The row

Ledger row `2026-11-02-the-radio-band-reads-the-delay-spread-and-discards-its-floor` logs it against
`radio-clock.js`, and that row closes to this brief. The brief claims no `**Residue:**` field of its
own: check8g holds a claim to a row whose SOURCE is the brief, and this row's source is the module.

`radio-clock.js` §4 bands an axis on `spreadMs`, the half-IQR of the residual about the width-21
running median. Wren's box-local read of the six Polar sidecars (2026-10-30 to 11-01, one connection
per device per night) measured the other edge of the same residual:

| stream | floor MAD | bulk IQR | worst 5-min window |
|---|---|---|---|
| H10 ECG | 2.2 ms | 32 ms | 6.9–12.4 ms |
| H10 ACC | 0.6 ms | 25 ms | — |
| Verity PPG | 9.3 ms | 180 ms | 37–40 ms |
| Verity ACC | 10.5 ms | 205 ms | — |

A frame waits in the device buffer and then for a connection event, so the delay carries a hard
minimum and a long upper tail. The band measures the tail. On the Verity it rejects an axis whose
floor holds to 9 ms.

## 2 · What this unit built

`anchorFloor(anchors, correctionAt, opts)` reads the floor of the SAME residual the spine publishes:
`hostMs − devMs − correctionAt(devMs)`, minimum and maximum per 5-min host window
(`CK_RADIO_FLOOR_WIN_MS`), medians and MADs over those windows, against a full IQR of the bulk. The
row quoted full IQRs, so this one does too — `stackJitterMs` is a HALF-IQR, and a reader comparing
the two straight would halve the tail. Every accepted axis carries it as `floor`; all six refusals
carry `floor: null`.

## 3 · What the measurement refuted

🔴 **A sharp floor is not a one-sided delay.** The obvious remedy — band the axis on `floorMadMs` —
dies on a control. At 300 anchors per window a symmetric ±32 ms plant reads `floorOverBulk` 0.0955
against the one-sided 8/180 ms plant's 0.2916. The symmetric shape reads SHARPER. Any distribution
bounded below reads a sharp floor, so the statistic cannot carry the decision.

What separates the two shapes is `asymmetry` — the upper excursion over the lower one — and it
separates them at both cadences with no overlap: 2.486 and 2.191 one-sided against 0.898 and 0.961
symmetric.

🔴 **`floorMadMs` is an extreme-value statistic.** One shape reads 0.2916 at 300 anchors per window
and 0.0450 at 1500. The floor did not sharpen; the sampling did. So `anchorsPerWindow` rides beside
it, and a reader comparing two streams' floors owes that count the way §7 owes an anchor count
beside a `ppm`. `asymmetry` carries no such debt.

🔴 **One anchor in a window is its own minimum and its own maximum.** Over such a population the
floor series, the ceiling series and the bulk are one series, so `floorMadMs` would report the bulk
scatter under the floor's name. The function refuses there by name and keeps `usedWindows` and
`anchorsPerWindow` real, because those two counts say how to fix it.

## 4 · What the band still does

Nothing changed. `anchorFloor` annotates (§∅: reduced coverage annotates, a discontinuity refuses).
A stream rejected over the 50 ms bound keeps its rejection while its floor sits at 9 % of its
spread, and the suite pins that leg. Moving the band needs §5.

## 5 · The decisive test, and why it is not here

The row states it: **PAT on the floor-mapped axis, stable between nights.** A per-connection floor
would convert the per-connection BLE offset (`PAT-PACKET-ARRIVAL`, −867…+1321 ms between nights)
into a per-model constant that one calibration removes. That claim needs the beat path and the
box-local sidecars.

🔴 **CORRECTED 2026-11-04 (Heron, rig measurement): the paragraph below measured a symlink, not a
corpus.** `find uploads/ -name '*RADIOCLOCK*'` returns 0, and `find -L uploads/ -name '*RADIOCLOCK*'`
returns 11 over the same tree. `uploads/vigil-archive` is a symlink to `/mnt/nas/vigil-archive`, and a
plain `find` never follows one. `docs/CORPUS-LOCATIONS.md` records that link under my own 2026-11-01
decision, and its table already names `/mnt/nas/vigil-archive/captures` canonical for a rig reader. The
eleven sidecars cover 2026-10-30, 2026-10-31 and 2026-11-01, and each one reached the rig before
2026-11-03, the date this brief carries. So §5 needs no box session. A rig session reads the archive
directly, and the arm keeps only its real cost: the beat path over three nights.

For the record, the sentence this correction withdraws: "The rig holds no `*RADIOCLOCK*` file (`find`
over `uploads/` returns 0, and `DEX_UPLOADS` is unset), so the arm belongs to a session on the capture
box." The `DEX_UPLOADS` half stays true and never mattered: the tools fall back to the primary
checkout's `uploads/`, which is where the symlink sits.

### 5a · Measured 2026-11-04 (Heron, rig over the NAS archive): the floor's anchor is the controller clock

The sidecar carries **three** clocks, and the published floor pairs two of them:

| column | clock |
|---|---|
| `last_sensor_ns` | the device's own PMD clock |
| `anchor_us` | the BLE **controller** clock, a counter whose epoch survives no controller reset |
| `acl_rx_ns` | the **host** clock, a `CLOCK_REALTIME` nanosecond stamp |

`radioclock.py` says so itself: `anchor_us` is "a controller counter", and `OffsetEstimator` keeps the
controller-to-host offset as a running median. The published floor reads `anchor_us − last_sensor_ns`,
so it measures the device against the CONTROLLER. `DexClock.hostAxis` anchors on the host stamp
(CLAUDE.md §🔒.7), so a floor map built on the controller carries the controller-to-host divergence
straight into the node's axis.

I ran the row's own method over the archived nights — floor per five-minute window, Theil-Sen through
the window minima with pairs at least twenty minutes apart, MAD about that line — on all three pairs.
Each line spans about seven hours over seventy or more windows.

**The published pair, device against controller:**

| night | Verity floor MAD | H10 floor MAD | Verity rate | H10 rate |
|---|---|---|---|---|
| 2026-10-30 | 8.26 · 10.18 ms | 2.58 · 1.26 ms | 359 ms/h | 386 ms/h |
| 2026-10-31 | 68.73 · 76.47 ms | 70.04 · 71.84 ms | 415 ms/h | 452 ms/h |
| 2026-11-01 | 9.70 · 12.49 ms | 0.88 · 3.18 ms | 357 ms/h | 384 ms/h |

**The control, controller against host — no device clock enters it:**

| night | rate | MAD |
|---|---|---|
| 2026-10-30 | 457.5 · 457.7 ms/h | 0.49 · 1.89 ms |
| 2026-10-31 | 531.6 · 539.1 ms/h | 82.41 · 92.26 ms |
| 2026-11-01 | 457.1 · 457.9 ms/h | 0.58 · 2.27 ms |

**The axis pair, device against host:**

| night | Verity | H10 |
|---|---|---|
| 2026-10-30 | −98.5 ms/h · MAD 2.91 · 7.38 ms | −71.3 ms/h · MAD 1.62 · 0.72 ms |
| 2026-10-31 | −118.0 ms/h · MAD 29.16 · 30.33 ms | −79.1 ms/h · MAD 13.54 · 4.18 ms |
| 2026-11-01 | −97.7 ms/h · MAD 3.08 · 10.37 ms | −72.7 ms/h · MAD 0.73 · 1.48 ms |

What the three tables say together:

1. 🔴 **The night that looks worst on the published pair holds no device fact.** The control carries no
   device clock, and on 2026-10-31 its MAD runs about forty times the other two nights. Both devices
   share one host and one controller, so two independent device crystals cannot inflate in step.
2. 🔴 **The controller is the degraded element.** The axis pair stayed far tighter on that same night,
   and the controller sits inside the degraded pair and outside the tighter one.
3. **On the axis pair each device keeps its own rate across nights** — the Verity near −98 ms/h, the
   H10 near −72 ms/h. On the published pair the same two rates move by about a sixth between nights.
4. **So the floor map belongs on the host stamp.** Anchoring it there drops the controller term, and
   the host stamp is the one the node's axis already reads.
5. ⚠️ **Every archived sidecar carries the nine-column header.** `device_clock` and `anchor_epoch`
   landed on 2026-11-02 (#4267, #4272), after these nights ended. A reader of this corpus cannot cut
   the axis at a link establishment by column, so it must infer a seam from `conn_handle` and from
   gaps in `anchor_us`. The 2026-11-01 files show two handles per device, which is a reconnect; the
   other two nights show one each.

A session scratchpad holds the streaming script that measured this, so the result is a measurement and
not a shipped tool. The port belongs with the beat half, which still owes the PAT comparison.

### Acceptance

- [x] The floor of the published residual reads as a statistic beside the band, never as a band input.
- [x] A symmetric control stands beside the one-sided plant, and the suite states which statistic
      separates them.
- [x] `anchorsPerWindow` ships beside `floorMadMs`, and a leg pins the sampling dependence.
- [x] Absence refuses by name: no spine, no correction curve, one window, one anchor per window.
- [ ] PAT per night on the floor-mapped axis, over the six box-local sidecars, with the between-nights
      spread quoted against the −867…+1321 ms it would replace. **Owed; a rig session can run it
      over the archived nights, corrected 2026-11-04. §5a measured the clock half on 2026-11-04 and
      moved the map onto the host stamp, so the beat half is what stays owed.**
- [ ] A band decision, if §5 earns one, with the threshold pre-stated before the data that judges it.
