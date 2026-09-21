<!--
  ORACLE-ECG-FIRMWARE-RR-2026-09-21.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** REFERENCE (living — re-run `tools/oracle-ecg-firmware-rr.mjs` when the detector, the alignment or the corpus changes) · **last-verified:** 2026-09-21 (both pairings)

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

## The time-anchored pairing — same 52 nights, later the same day

Built as the "next instrument" the section below asked for, with its bands written into the tool
header before its first run: cumulate the firmware RR into a device axis, anchor each 300-beat
window to host time by the lower envelope of `arrival − cumulative`, recover the stream's delivery
**latency per window by coincidence search** (it is ≈ 2.2 s and **steps at reconnections** — 1.3 s,
0.2 s, −1.2 s, +4.6 s windows measured; a window straddling a step is halved down to 150 beats; a
window with no coincidence peak is *unanchored*, never paired at the night's average), then pair
one-to-one within ±150 ms.

| statistic (time pairing) | bar | median over 52 nights | verdict |
|---|---|---|---|
| matched self (ECGDex beats with a firmware beat) | ≥ 97 % | **98.7 %** (IQR 96.1–99.5) | CONSISTENT |
| matched firmware (in ECGDex coverage) | ≥ 97 % | **99.2 %** | CONSISTENT |
| RR \|Δ\| on consecutively matched pairs | ≤ 8 ms | **0.45 ms** — ≤ 8 ms on **52 of 52** nights | CONSISTENT |
| RR LoA (1.96·SD) on pairs | ≤ 30 ms | 35 ms | SHORTFALL |
| RR empirical 95 % half-width | — | 1.9 ms | — |
| \|Δt\| of pairs (after anchoring) | — | 35 ms | — |
| stream latency, median / p5–p95 spread within a night | — | 2.21 s / 1.1 s | — |

**So the 25 "unpaired" nights of the index alignment were the instrument, not the detectors**: once
the firmware beats are placed on the host axis, the two detectors place the same beats within one
sample on every night, and the extent difference (firmware beats outside ECGDex coverage: 15 417;
unanchored, no coincidence peak in their window: 39 583 across 262 windows) is accounted for rather
than scored as disagreement. The LoA shortfall is tail-driven — the empirical width says the body of
the paired differences is within 2 ms; the tails are residual mispairs at ±one RR — and is reported
exactly as the pre-registered band says, not re-banded. Four nights match < 90 % (2026-09-04 48.7 %, 09-20
48.7 %, 09-05 70.7 %, 08-29 80.4 %): each carries 14–33 anchor jumps, a within-night latency spread of
5.6–11.0 s and 2 100–3 653 firmware beats in 14–25 *unanchored* windows — on 09-20, 3 300 of 8 234
firmware beats sit in windows with no coincidence peak, so the 48.7 % is the pairing instrument's
coverage on a reconnection-heavy night, not the detectors disagreeing. Their paired RR still agrees
(|Δ| 0.45–0.77 ms on three of them; 09-04 sits at 7.98 ms, at the band) while their LoA runs 39–98 ms
with an empirical 95 % width of 28–77 ms — on these nights the tails are real, and they are the
tails that put the pooled LoA over its bar. Listed, not averaged over.

⚠️ Two plants corrected the instrument before the corpus saw it: the coincidence search first took
the plateau's *edge* (biased by up to the tolerance; now its centre), and a window straddling a
latency step was *refused* as "no peak" before the halving check ran (now halved first).

## What this does not decide

- Which detector is "right" where the two disagree on a beat's *existence* (the ~1–3 % unmatched on
  either side): nothing here can, and §5 forbids reading it as an auto-fix either way.
- The PPG leg: 37 Verity nights carry a `_PPI.txt`, 32 with ≥ 300 rows — coverage only; nothing
  compared. Its own unit, sized from that count.

⚠️ P5: measured internally under the owner's 2026-09-12 ruling; not for external quotation. Bands were
not moved after the run; where the instrument was wrong, the instrument was fixed and both numbers
are stated above.
