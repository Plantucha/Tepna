<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-07-08 · **Created:** 2026-07-08

# PAT (Pulse Arrival Time) feasibility — ECG R-peak → PPG foot coupling

> **What this is.** A feasibility spike for the vascular metric parked in
> [`ECGDex-BUILD-BRIEF.md`](ECGDex-BUILD-BRIEF.md) §6 ("Vascular metrics — verdicts").
> It answers ONE question with real data: can per-beat **PAT** (PPG foot − ECG R-peak)
> be recovered from a simultaneous Polar H10 (chest ECG) + Polar Verity Sense (forearm
> PPG) night captured by **Polar Sensor Logger**? **Answer: NO, not from the phone-
> timestamped dumps** — the two device clocks drift ~48 ppm apart over a night, which
> swamps the PAT signal. The **sensor blocker is lifted** (raw PPG is now in the fleet);
> the **new binding constraint is time synchronisation**, which is exactly
> [`POLAR-SDK-CAPTURE-2026-07-07-BRIEF.md`](POLAR-SDK-CAPTURE-2026-07-07-BRIEF.md).
>
> **Instrument:** `PAT Feasibility.html` + `pat-feasibility.js` (root, house analysis-tool
> pattern — reuses the production `ECGDSP` + `PPGDSP` verbatim, runs 100% in-browser).
> Re-runnable the moment a synchronised capture exists.

---

## Method (faithful — no re-implementation)

- **R-peaks** — `ECGDSP.parseECG` → `ECGDSP.bandpass` → `ECGDSP.detectPeaks`; absolute time
  `t0Ms + idx/fs·1000` (floating wall-clock, Clock Contract).
- **PPG feet** — `PPGDSP.parsePPG` → `PPGDSP.detectChannel` per LED → `PPGDSP.consensusBeats`
  (the honest 3-LED consensus, per `CLAUDE.md` §🎙️) → foot time `t0Ms + relSec[foot]·1000`.
- **Shared-clock test** — decided by HARD evidence (start-time alignment + beat-count parity),
  NOT the coupling rate.
- **Coupling** — each R paired to the first foot after it; a beat "couples" if its lag sits
  within ±90 ms of a **±30 s rolling-local baseline** (a single night-wide mode wrongly
  penalises a legitimately drifting-but-coherent lag — the spike's first-pass mis-called it).
- **Stability** — median lag per 5-min bin → drift range + slope; beat-to-beat spread =
  IQR of (lag − local baseline).

## Result — real night 2026-07-06 (O2Ring-era corpus; H10 `028…` + Verity `0C3…`)

| Signal | value |
|---|---|
| Shared clock | **YES** — Δstart **1.42 s**, beat counts **0.02 %** apart (19 922 R vs 19 926 feet, both 401.1 min) |
| Coupling | **89.5 %** of R-peaks (17 828) couple to a coherent foot |
| Beat-to-beat spread | **47.5 ms** (locally tight) |
| Median lag | 454 ms (forearm site + foot-vs-R convention → longer than fingertip PAT) |
| **Baseline drift** | **1147 ms across the night** (~**48 ppm**, slope −45 ms/h) |
| Verdict | **DRIFT-DOMINATED — needs hardware sync** |

**Interpretation.** The streams are unambiguously the same heart on one session, and locally
the coupling is tight (48 ms). But the R→foot **baseline swings ~1147 ms** — ≈ one full
cardiac cycle at the ~50 bpm mean RR. Causes, both real: (1) the two **device crystals drift
~48 ppm apart** — the phone timestamp only pins the START to ~1.4 s, after which each stream
rides its own device clock; (2) where the drift crosses an RR interval, the "first foot after
R" **slides onto the neighbouring beat** (why coupling stays at 89.5 % while the absolute lag
jumps a whole cycle). The drift is **~24× the physiological PAT signal** (tens of ms), so
absolute PAT is impossible AND a relative trend is swamped.

## Decision

- **PAT / arterial-stiffness (PWV) is NOT buildable from Polar Sensor Logger dumps.** Do not
  ship a Vascular panel on this capture path. The ECGDex §6 "unlocks only when a raw-PPG
  peripheral sensor joins the fleet" note is **stale** — the sensor is here; the blocker moved
  to **inter-device time sync**.
- The feasibility instrument is **retained** (`PAT Feasibility.html`) as the go/no-go gate for
  any future synchronised capture — re-run it, and a green **FEASIBLE — provisional trend**
  (drift ≤ 60 ms) is the bar.

## Potential future solution (the unblock — recorded, not scheduled)

Two independent paths, either sufficient; both live under
[`POLAR-SDK-CAPTURE-2026-07-07-BRIEF.md`](POLAR-SDK-CAPTURE-2026-07-07-BRIEF.md):

1. **SDK-mode synchronised device timestamps (preferred).** The `polar-ble-sdk` exposes each
   device's own **sensor timestamp** (the `sensor timestamp [ns]` column already present in
   both files, per-device monotonic). Capturing both sensors through one SDK host that records
   a common reference lets the two device clocks be cross-calibrated (drift modelled + removed),
   collapsing the 48 ppm slide. Re-run this spike on such a capture.
2. **Periodic shared sync marker (no-SDK fallback).** Emit a **double-tap** visible in BOTH the
   H10 and Verity **ACC** streams every few minutes; cross-correlate the taps to re-pin the
   offset and fit/remove the linear drift between markers. Then PAT is computed on the
   drift-corrected timeline. `pat-feasibility.js` would gain a `syncTaps` correction stage.

**When either lands:** re-run `PAT Feasibility.html` on a synchronised night. If drift falls
below ~60 ms with coupling ≥ 55 % and beat-to-beat IQR ≤ 60 ms, promote to a **Vascular
(trend only)** panel — **experimental** evidence tier, **never** an absolute BP number
(PAT = PEP + PTT; the pre-ejection-period confound needs a cuff to calibrate).

## Done when

- ☑ Feasibility answered on real data (recorded **no-go** for the current Polar Sensor Logger
  capture; root cause = ~48 ppm inter-device drift).
- ☑ Reusable go/no-go instrument shipped (`PAT Feasibility.html` + `pat-feasibility.js`).
- ☑ Unblock path recorded (SDK sync / ACC-tap sync → re-run the spike).
- ☐ (future) Re-run on a synchronised capture — tracked against `POLAR-SDK-CAPTURE`.

**Cross-refs:** `ECGDex-BUILD-BRIEF.md` §6 · `POLAR-SDK-CAPTURE-2026-07-07-BRIEF.md` ·
`CLAUDE.md` §🎙️ (honest-HR: derive from raw waveform) · §🔒 THE CLOCK CONTRACT.
