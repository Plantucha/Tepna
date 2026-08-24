<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-08-24 · **Created:** 2026-08-24 · **Follows:** `CPAP-EDF-WRITER-FOLLOWUPS-2026-08-23-BRIEF.md`

# CPAP live-BLE vs SD-card comparator test — real-data validation, and a comparator bug the real geometry exposed

A real-data test of the live-BLE-stream capture against the device's own SD-card recording, run on the
attended CPAP session of 2026-08-24 (the same session as the AS11 detection matrix). It validates the
BLE capture, characterises one channel divergence, and — the reason this is its own brief — exposes a
bug in the **box** comparator probe that a synthetic *contained-overlap* fixture would never have caught.

## The test
Compared today's BLE-stream `BRP.edf` against the SD-card `BRP.edf` for the same session (both flow +
pressure, 25 Hz). Files on the box:
- BLE: `captures/cpap-ble/DATALOG/20260824/20260824_174542_BRP.edf` (300 s)
- SD:  `captures/cpap/DATALOG/20260824/20260824_174018_BRP.edf` (420 s) · a second SD segment
  `20260824_174806_BRP.edf` was **empty** (0 samples — a header-only artifact of the stop/restart toggle)

Both files carry the **same device clock**, so alignment anchors on it (start-time delta = 324 s) and the
regression runs only the device-clock intersection.

## Findings
| Channel | scale (BLE/SD) | Pearson r | RMSE | verdict | tier |
|---|---|---|---|---|---|
| **Flow** | **1.00000** | **0.99998** | 0.00282 L/s | **IDENTITY** — BLE is a byte-faithful copy of the SD flow | MEASURED |
| Pressure | 0.93923 | 0.93819 | 0.1110 | ~6 % scale + shape divergence, even in clean therapy | MEASURED |

- **Flow capture is validated:** the BLE stream reproduces the SD-card flow exactly. Confirmed by TWO
  independent tools — tepna-99's CPAPDex surface comparator (`cpapdex-cross.js compareChannel`, #1735):
  `clockOffset 324.0 s · scale.a 0.99998 · residSD 0.0028 · BA bias ~0 · appliedLag −0.36 s`, and the
  (now-fixed) box probe: `scale 1.00000 · r 0.99998 · lag −0.36 s`. They agree to 4 s.f.
- **Pressure diverges (~0.94×, r 0.94)** — a real pressure-channel difference (alignment is provably
  exact: flow r = 1.0 on the same window, so this is not misalignment). Scoped as the comparator's **§4
  multi-channel follow-up** (v1 is Flow-only); plausibly a writer-side pressure scaling, the same *class*
  as the flow unit was before it was pinned to L/s. NOT yet resolved.
- **Coverage:** the BLE stream captured **204 s the SD card clipped** — the mask-off and the therapy stop
  — because the SD card boundary-clips at the session end while the BLE stream runs through it. For the
  session-detection work this makes the BLE stream *richer* than the SD card, not merely equal.

## The comparator bug (box `cpap_pin_compare.py`) — and why it matters
Running the **box** reference probe first gave `scale 0.229, r 0.276, "NON-IDENTITY"` — **wrong**. Root
cause: it did a blind cross-correlation assuming the live recording is **contained** in the SD one, so it
searched offsets only in `[0, len_SD − len_live]` ≈ `[0, 120 s]`. But today the BLE recording starts
**324 s** into the SD one and extends **204 s past its end** — the true offset is outside the search
window. It locked a spurious peak (coarse xcorr **0.289** — not a match) and regressed over the whole
non-overlapping length → garbage. It then **reported a confident scale off a bad lock** — the §4b family
("reported success about something it never examined").

This is the **normal** geometry, not an edge case: the SD card boundary-clips and the BLE stream does
not, so partial overlap (live extends past SD) is what real data looks like. A synthetic
contained-overlap fixture would have passed forever.

## The fix
- **The surface comparator (#1735) never had the bug** — by design it anchors on the device clock and
  regresses only `[max(start), min(end))`, so partial overlap is the intersection *by construction*, and
  it examines + reports overlap quality (low scale + high residSD) rather than locking a peak.
- **The box probe is fixed** (2026-08-24, old version kept as `cpap_pin_compare.py.blind-xcorr.bak`):
  takes argv (`LIVE SD [channel]`), anchors on the device clock, regresses only the intersection, does a
  ±5 s fine xcorr for the sub-second residual, and **REFUSES on an align-peak < 0.5** instead of reporting
  a scale off a bad lock. It now reproduces the surface to the digit.
- tepna-99 is adding a **synthetic partial-overlap regression twin** (short starts partway into long AND
  extends past its end → assert overlap == the `[max(start),min(end))` intersection, scale recovered) to
  gate-lock the geometry on the surface side — committed-adversarial-twin discipline.

## Lesson
A real partial-overlap night is exactly the case a synthetic *contained*-overlap fixture cannot catch —
and it is the *normal* case, because SD boundary-clips while the BLE stream runs through the transitions.
Anchor on the device clock when both files carry it; regress only the true intersection; refuse on a low
alignment peak rather than reporting a scale off it.

## Open item
The **pressure-channel ~0.94 divergence** (flow is perfect) — resolve whether it is a constant writer-side
scale (a fixable gain, like the flow unit) or a signal-processing difference (decimation/filter). Routed
to the comparator's §4 multi-channel follow-up and the CPAP-EDF-writer investigation.
