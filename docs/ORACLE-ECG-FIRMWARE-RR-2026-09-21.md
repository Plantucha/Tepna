<!--
  ORACLE-ECG-FIRMWARE-RR-2026-09-21.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** REFERENCE (living — re-run `tools/oracle-ecg-firmware-rr.mjs` when the detector, the alignment or the corpus changes) · **last-verified:** 2026-09-21

# ECGDex's Pan–Tompkins against the H10 firmware detector — 52 real nights

**Roadmap item.** `MEASUREMENT-PROVENANCE-ROADMAP` §5: *"harness runs at least the R-peak and HR
comparisons on real nights with pre-stated bands."* The harness is `tools/oracle-ecg-firmware-rr.mjs`;
the bands are in its header and were written before the first night was read; every run prints §5's
two caveats first: **a reference is a reference, not ground truth**, and **agreement between two
algorithms proves nothing physiological**.

**The reference** is the strap's own firmware RR train (`*_RR.txt`) — an independent QRS detector run
in the strap on the same lead. No third-party library was needed, so §5's quarantine (dev-dep, SOUP
note, never bundled) is satisfied by construction. MIT-BIH answers the other question
(`tools/ecg-physionet-differential.mjs`).

## Result — pooled medians over 52 nights, 965 326 beats (`/srv/data/tepna-corpus/smoketest-captures`)

| statistic | pre-stated CONSISTENT bar | median | verdict |
|---|---|---|---|
| mean RR Δ | ≤ 1 % | **0.40 %** | CONSISTENT |
| rMSSD Δ | ≤ 10 % | **1.2 %** (IQR 0.3–3.0) | CONSISTENT |
| SDNN Δ | ≤ 5 % | 8.85 % (IQR 1.2–21.8) | SHORTFALL |
| beat count Δ | ≤ 1 % | 1.55 % | SHORTFALL |
| per-beat \|Δ\| (index alignment, stable range) | ≤ 8 ms | 17.7 ms | SHORTFALL |
| RR LoA (1.96·SD, paired) | ≤ 30 ms | 81 ms | INVESTIGATE |
| RR empirical 95 % half-width | — (not banded) | 42 ms | — |

**Read the two pairing-free rows as the detector comparison**: on the same filtered trains the two
detectors agree on mean RR to 0.4 % and on rMSSD to 1.2 %. The three pairing-dependent rows are
**bimodal**, and the split is the finding about the *instrument*:

| per-beat \|Δ\| | nights |
|---|---|
| ≤ 8 ms — paired within one sample (median ≈ 1 ms) | **20** |
| 8–20 ms | 7 |
| > 20 ms — read as **UNPAIRED**, not disagreeing | **25** |

On **45 of 52 nights the firmware train has more beats** than ECGDex's NN (up to +34 %): the RR file
spans the whole BLE connection while the NN covers the accepted stretch, and the surplus arrives in
bursts where ECGDex refused. `alignFirmwareRR` re-fits its offset within ±60 beats per decile, so a
burst wider than that loses the train for the rest of the night — and `pairingDecays` does not flag a
pairing that is *uniformly* wrong. SDNN, a whole-record dispersion, inherits the extent difference the
same way (08-11: firmware 28 605 beats / SDNN 284 vs self 21 379 / 88); rMSSD, local, does not.

## Two things the run found on our side

1. **`ECGDex.validateRR` — and the export's `validation` block — compares a gap-contaminated train.**
   `r.nn` keeps intervals that straddle a dropout (flagged `nnSpansGap` inside `analyze`, excluded from
   the headline rMSSD there, never published). On 2026-09-03, 22 such intervals (largest 1 232 840 ms —
   a 20-minute dropout counted as one beat-to-beat interval) make the shipped export read
   `validation.dRMSSDPct = 65 797.8`; with the firmware's own 200–3000 ms window applied to both sides
   the night reads self 32.4 vs firmware 34.9 ms, dRMSSD 7.1 %. The harness applies that symmetric
   filter and reports the count excluded; the DSP fix is a separate PR
   (residue `2026-09-21-validaterr-compares-gap-spanning-intervals`).
2. **The first version of the harness's own LoA paired with one global offset** and read ≈ 165 ms
   against a per-beat median of 0.45 ms on the same night — the instrument measuring its own drift.
   It now pairs per window with the window's own offset, as ECGDex does, and prints the empirical
   95 % half-width beside 1.96·SD so a reader can see whether tails or the body drive the number.

## What this does not decide

- Which detector is "right" on the unpaired nights: nothing here can, and §5 forbids reading it as an
  auto-fix either way. The next instrument is a **time-anchored pairing** — cumulate the firmware RR
  into a device axis, re-anchor it on the arrival stamps every few hundred beats (they are BLE-batched,
  ±300 ms, but the drift is ~0.5 s per night), and pair by tolerance window — which is the pairing §5
  literally names and the unit that turns 25 "unpaired" nights into a measurement.
- The PPG leg: 37 Verity nights carry a `_PPI.txt`, 32 with ≥ 300 rows — coverage only; nothing
  compared. Its own unit, sized from that count.

⚠️ P5: measured internally under the owner's 2026-09-12 ruling; not for external quotation. Bands were
not moved after the run; where the instrument was wrong, the instrument was fixed and both numbers
are stated above.
