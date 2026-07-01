<!--
  ECG-RPEAK-SEED-FIX-2026-06-27-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-06-27 · **Created:** 2026-06-27 · **Followed-by:** ECGDEX-FOLLOWUPS-II-2026-06-27-BRIEF.md (§ "Pan-Tompkins search-back" — the general mid-file case)

# ECGDex — R-peak detection seeds the threshold from a startup electrode-settling transient

## The bug (user-reported)

A real overnight chest-strap file — `Polar_H10_AAAAAAAA_20260625_215300_ECG.txt` (Polar Sensor
Logger, ~3.26 M rows / ~7 h @130 Hz) — **failed to analyze in ECGDex** with:

> `Too few R-peaks detected — signal may be flat or not ECG.`

It is **not** an ingest/format/size problem. The file parses cleanly (header
`Phone timestamp;sensor timestamp [ns];timestamp [ms];ecg [uV]`, streams through the worker, the
`timestamp [ms]` column flips to scientific notation `2.5086244E7` late in the file but `parseFloat`
handles it). The throw is in **analysis**: `analyze()` (`ecgdex-dsp.js`) runs Pan-Tompkins, finds
**<12 R-peaks across the whole night**, and errors (`ecgdex-dsp.js`, the `peaks.length < 12` guard).

## Root cause — `detectPeaks` seeded the threshold from `max(first 2 s)`

```js
// OLD:
let init = 0; const initN = Math.min(N, 2*fs);
for (let i = 0; i < initN; i++) init = Math.max(init, integ[i]);   // max of the first 2 s
let SPKI = 0.5*init, NPKI = 0.1*init, THRI = NPKI + 0.25*(SPKI-NPKI);
```

This recording **opens mid electrode-settling**: the first ~1 s decays `5064 → ~350 µV`
(a steep settling transient) while the genuine overnight QRS is only **~600 µV** (real beats are
present throughout — e.g. a clean R-peak `…145, 315, 543, 635, 416, 27, −195…` at 22:32). Pan-Tompkins
**squares the derivative**, so in the integrate domain the 2 s settling window sets `init` ≈ **18× the
true QRS level**. Then the trap: **`SPKI` only updates when a peak FIRES** (`SPKI = 0.125·integ[i] +
0.875·SPKI` inside the detection branch). Seeded ~18× too high, no beat ever crosses `THRI`, so `SPKI`
never decays, `THRI` stays pinned, and detection collapses to **~1 peak for the whole night → throw**.

Recordings that begin *after* the strap has settled don't trip it — which is why only some nights fail.

### Empirical proof (real DSP, real transient)
A clean synthetic overnight ECG (scaled to ~600 µV R-peaks) → `analyze()` OK (448 NN beats). Prepend
the **real captured transient** from this file → `analyze()` THROWS; the detector finds **1 peak**
(seed `init = 2.5e6` vs the robust scale `1.4e5` — ~18×). Same signal, same beats; the only difference
is the prepended transient. (Harness: `_diag/ecg-seed-repro.html`.)

## The fix — robust global-percentile seed (`_seedScale`)

Seed the integrate threshold from a **subsampled ~99th percentile of the WHOLE record's integrate
feature** (≈ a strong-QRS level) instead of the max of the first 2 s:

```js
function _seedScale(integ, fs){ /* strided subsample → sort → 99th pct; degenerate → legacy 2 s max */ }
…
let init = _seedScale(integ, fs);
```

Why it's correct *and* low-regression:
- The integrate's elevated regions are wide (~100 ms window), so a strided subsample reliably hits
  them; the **99th pct ≈ the old `max(first 2 s)` on a CLEAN record** → clean-file detection is
  ~unchanged (behaviour-preserving).
- A **≤2 s startup transient is a negligible fraction** of a multi-hour night → it no longer moves the
  seed. (~0.01 % of a 7 h record; the 99th-pct threshold sits at the QRS level regardless.)
- Degenerate (all-zero integrate) falls back to the legacy 2 s max, so a genuinely flat file still
  hits the `<12` guard and errors as before — the honesty signal is preserved.

### Verified on the patched DSP (`_diag/ecg-seed-verify.html`)
| scenario | clean | + startup transient |
|---|---|---|
| `osa` 2 h | 6981 beats, HR 58.1 | **6488 beats, HR 57.4** (ΔHR 0.7) — was THROW |
| `hour` 30 min | 1792 beats, HR 59.7 | 1509 beats, HR 58.3 (ΔHR 1.4) — was THROW |

Detection survives the transient with the mean HR essentially unchanged; the transient's own
low-quality region is correctly SQI-gated.

## Done when (all met)
- ✅ `ecgdex-dsp.js` `detectPeaks` seeds from `_seedScale` (global pct), not `max(first 2 s)`.
- ✅ Regression gate: `tests/dex-tests.js` group **12c** ("ECGDex R-peak seed — survives a startup
  settling transient") — clean baseline + transient-prepended overnight ≥85 % beat retention, ΔHR ≤ 3,
  and a source-guard that the fix is the SEED (not a relaxed peak-count floor) and the `<12` guard is
  intact. Reverting the seed turns it red.
- ✅ `Dex-Test-Suite.html` all-green (**1100 / 71**, +3 groups: 12c seed-fix, 12d/12e from
  ECGDEX-FOLLOWUPS §2/§4).
- ✅ EXPORT-INERT: the seed fix only changes R-peak *seeding*; the ECGDex equiv fixture
  (`uploads/ECGDex_2026-06-27_equiv.node-export.json`, a 0-event 6-min clip) reproduces byte-identical
  via the patched source (`env.equiv.ecgdex` green) → NOT regenerated; producing-bundle `manifestHash`
  re-recorded in `FIXTURE-PROVENANCE.json` (GATE B).
- ✅ Re-bundled `ECGDex.html` (external-JS-only): `manifestHash 7c625af51078→bfa1aa934fcc`,
  `buildHash 146ac9c8b1bd` UNCHANGED. `BUILD-MANIFEST.json` GATE A updated → `verify-provenance.html`
  GATE A 8/8 PASS, GATE B ECGDex reproducible ✓. Other 7 bundles untouched.

## Follow-up (spawned)
The robust seed fixes the **startup** case. It does **not** fix the *general* mid-file recurrence —
a large mid-record artifact can still spike `SPKI`, which then only decays on a detected peak, so a
run of smaller real beats after it can be missed. The canonical Pan-Tompkins **search-back** (relax
`THRI` toward `NPKI` when no QRS appears for > ~1.66× the running mean RR) self-heals that general
case and is the proper complete fix. Deliberately **out of scope** here (minimal, proven, low-
regression change for the reported bug). Captured in `ECGDEX-FOLLOWUPS-II-2026-06-27-BRIEF.md`.
