<!--
  RADIO-DELAY-FLOOR-2026-11-03-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
  Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
  project root, or http://www.apache.org/licenses/LICENSE-2.0
-->
**Status:** PROPOSED (core BUILT, remainder corpus-blocked — verified 2026-11-03: `anchorFloor` ships and eleven suite legs pass. The rig holds no sidecar, so the box owes §5. **RE-TRIAGED 2026-11-04 (Heron, box read-only; rule 0: "solid night cowear probe stage lab O2Ring presence trigger radio delay floor vigil coexistence brief status"): §5'S PRECONDITION IS MET ON THE BOX, so the arm is SCHEDULABLE and no longer corpus-blocked.** `/srv/tepna/captures` holds fourteen `*RADIOCLOCK*` sidecars over four nights — 2026-10-30, 2026-10-31, 2026-11-01 and 2026-11-03 — where this brief's own §5 expected six. The sentence that the rig holds none stays true of the RIG, and it was never a statement about the box. No `*PAT*` file exists beside them, so PAT still comes from the beat path at analysis time. What §5 now owes is the analysis itself, which a box session can run read-only, and the second box still waits on §5 earning a band) · **Created:** 2026-11-03

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
box-local sidecars. The rig holds no `*RADIOCLOCK*` file (`find` over `uploads/` returns 0, and
`DEX_UPLOADS` is unset), so the arm belongs to a session on the capture box.

### Acceptance

- [x] The floor of the published residual reads as a statistic beside the band, never as a band input.
- [x] A symmetric control stands beside the one-sided plant, and the suite states which statistic
      separates them.
- [x] `anchorsPerWindow` ships beside `floorMadMs`, and a leg pins the sampling dependence.
- [x] Absence refuses by name: no spine, no correction curve, one window, one anchor per window.
- [ ] PAT per night on the floor-mapped axis, over the six box-local sidecars, with the between-nights
      spread quoted against the −867…+1321 ms it would replace. **Box-local; owed.**
- [ ] A band decision, if §5 earns one, with the threshold pre-stated before the data that judges it.
