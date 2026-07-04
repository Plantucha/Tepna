<!--
  OXYDEX-HR-ARTIFACT-RUNAWAY-FIX-2026-07-03-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-07-03 · **Created:** 2026-07-03 · **Trigger:** user report ("algorithms way too off, 100 bpm absolutely wrong; first few seconds always look like artifacts")

# OxyDex — HR artifact cleaner runs away to a stale anchor + device warm-up placeholder corrupts the night

## The bug (user-reported)
An overnight O2Ring export read **HR = 100 bpm flat all night** (`meanHr = minHr = maxHr = 100`,
`hrCV = 0`) with **22083 of 22108 samples "artifact-cleaned"** — while the SAME night's ECGDex read
**48.4 bpm** from the R-R intervals. The user also observed that the opening seconds of a recording
"always look like artifacts" and asked whether to ignore the first 2–5 s (and check the tail).

Both observations are the same root event. Confirmed against the raw file
`O2Ring S 2100_20260702220521.csv` (copied to `uploads/` for validation):

```
22:05:21 … 22:05:45   84, 100, 0     ← 25 rows, byte-frozen  (device warm-up placeholder)
22:05:46              93,  53, 0      ← finger-clip perfusion locks, real signal begins
```

The O2Ring holds a **frozen placeholder** (`SpO2=84 / HR=100`, motion 0) for the 25 s before it gets
a perfusion lock, then the true signal appears. That is NOT a 2–5 s window — for the pulse-ox it was
25 s here, 8 s on `20260503` (`85/55`), 0 s on `20260612` (locks on sample 1). (The ~2 s figure the
user pictured is the **Polar H10 ECG** electrode-settling transient — a different sensor, already
handled by `ECG-RPEAK-SEED-FIX-2026-06-27`.)

## Root cause
Two independent defects, both seeded by that warm-up block:

### 1. `cleanArtifactHR` clamps the whole night to a stale anchor (the catastrophic one)
The cleaner flags any ≥20 bpm 1-sample HR step as an artifact, sets `baseline = rows[i-1].hr` (the
value BEFORE the step), then walks forward **until HR returns within RECOV(=10) of that baseline**,
overwriting every intervening sample with `baseline`. The recovery search had **no upper bound**.

At the sensor lock, HR steps 100→53 (a −47 drop). `baseline` is pinned to the **placeholder 100**,
and true sleep HR (~48–56) never climbs back above 90 — so the loop ran to the end of the file and
rewrote the ENTIRE remaining night to a flat 100. One early trigger silently replaced 5.6 h of real
data. (Same failure *class* as `ECG-RPEAK-SEED-FIX`: a startup transient poisoning a whole-night
detector. ECGDex/PulseDex/PpgDex are NOT affected — their `buildNN`/`artifactClean` use a bounded
local-median correction, DEX-DSP-AUDIT-BEATS-ARTIFACT.md; this runaway pattern is OxyDex-only.)

### 2. The warm-up placeholder also sets a false critical `minSpo2`
Independently, the frozen `SpO2 = 84` leaks into the SpO2 stats as the night's **nadir** — the export
ranked `minSpo2 = 84` as the #1 red finding ("SPO2_CRITICAL_DIP", impression "nadir SpO₂ 84%"), when
the real desaturation nadir was 87 and `spo2P5 = 93`. So the placeholder fabricates a scary finding on
a channel the HR bug doesn't even touch.

## The fix (2 parts, both in `oxydex-dsp.js`, DSP-only)

### Fix 1 — bound the clamp *(APPLIED)*
`CFG.HR_ARTIFACT_MAX_RUN_SEC = 60`. The recovery search stops after 60 s (≈samples @1 Hz); if recovery
never arrives, the anchor is presumed bad (or the step was a real sustained transition) and the raw
values are **left untouched** (not clamped, not counted as corrected), resuming the scan from there.
Bounds the blast radius of a bad anchor to ~1 min instead of the rest of the recording; also protects
against any mid-night glitch, not just the startup one.

### Fix 2 — trim the device warm-up / cool-down placeholder *(APPLIED)*
New `trimSensorWarmup(rows)` called at the top of `processNight` (the shared chokepoint for the app
AND headless `compute()`), BEFORE `cleanArtifactHR` — mirroring how `parseCSV` already drops the
device's `- -` no-reading rows. **Adaptive, not a fixed cut**, and deliberately conservative:
a leading/trailing run is trimmed only if it is (a) byte-frozen-identical in (SpO2,HR), (b) at the very
edge, (c) ≥ `WARMUP_MIN_SEC` (5) long, (d) bounded from the real signal by an abrupt lock-on step
(upward SpO2 ≥ `WARMUP_SPO2_STEP`(4), or |ΔHR| ≥ 20), and (e) never trims below the 60-row floor or past
`WARMUP_MAX_SEC` (300). The step condition is what keeps genuine flat stretches — elevated awake HR
settling smoothly (`20260624`: 6 flat rows, no step → kept), stable deep-sleep SpO2, a clean sample-1
lock (`20260612` → kept) — untouched. Surfaced via new info flags `SENSOR_WARMUP_TRIMMED(n)` /
`SENSOR_COOLDOWN_TRIMMED(n)` (present only when a trim fires → zero churn on clean nights).

## Done when (acceptance) — ALL MET
- [x] `cleanArtifactHR` recovery search is capped (`HR_ARTIFACT_MAX_RUN_SEC`=60); a non-recovering run no longer clamps past the cap.
- [x] `trimSensorWarmup` implemented + wired into `processNight` before `cleanArtifactHR`; exposed on bare-globals + `OxyDex.trimSensorWarmup`; `SENSOR_WARMUP_TRIMMED`/`SENSOR_COOLDOWN_TRIMMED` info flags added.
- [x] `20260702`: `meanHr` **100 → 48.6** [43–71] (real ~50s, not the flat 100), `maxHr` **100 → 71**, `minSpo2` **84 → 87** (the false frozen-84 nadir removed; 87 is a genuine reading, so `SPO2_CRITICAL_DIP` at ≤88 correctly *remains* — it is now honest, not fabricated), 25-sample warm-up trimmed, `cleaned=0` (no runaway).
- [x] Corpus scan (ALL 44 raw O2Ring nights, real-code `_diag` harness): **4 warm-ups trimmed** (8/14/9/25 samples — `20260503`/`20260513`/`20260526`/`20260702`, each verified row-by-row as a frozen placeholder ended by a lock-on step); `20260612` (immediate lock) + `20260624` (real elevated-HR settling) **NOT trimmed**; both committed fixtures **byte-identical** (EXPORT-INERT).
- [x] Regression test in `tests/dex-tests.js`: group *“OxyDex HR-artifact runaway clamp + warm-up trim (100bpm fix)”* — runaway-clamp bailout, `trimSensorWarmup` (warm-up trimmed / real-flat kept / clean untouched / frozen-no-step kept), + end-to-end `compute()`.
- [x] Gates green: `Dex-Test-Suite.html?full` **✓ all green, 1722 passed / 116 groups, bootSkips [], renderCoverageRan** (incl. `env.equiv.oxydex` byte-identical) + `verify-provenance.html` **GATE A 8/8 + GATE B, `__provenanceOK=true`**.

## Result (verified 2026-07-03)
- **The reported bug is fixed:** `20260702` HR **100 flat → 48.6 mean**, matching the same night's ECGDex (~48 bpm).
- **Re-bundle:** OxyDex.html `manifestHash` **a16db72bc689 → 91196f73460c** (buildHash `04d85b8b647d` inert/unchanged). `BUILD-MANIFEST.json` (GATE A) + both OxyDex fixture records in `FIXTURE-PROVENANCE.json` re-recorded **manifestHash-only** (EXPORT-INERT; `outputHash`/`inputHashes` unchanged — NOT regenerated).
- **Follow-ups spawned:** `OXYDEX-HR-ARTIFACT-RUNAWAY-FIX-FOLLOWUPS-2026-07-03-BRIEF.md` — two things the corpus scan surfaced that are OUT of this fix's frozen-placeholder scope (gradual-ramp warm-ups; mid-night extreme-low SpO₂ artifacts feeding `minSpo2`/`SPO2_CRITICAL_DIP`).

## Gates & re-bundle (mandatory — DSP behavior changed)
1. Edit `oxydex-dsp.js` only; **re-bundle `OxyDex.html`** (`OxyDex.src.html` script wiring unchanged).
2. Let the build settle, **RE-READ** the new `manifestHash`, hand-update OxyDex's entry in `BUILD-MANIFEST.json` (GATE A hard-fails on stale).
3. The fix MOVES HR/SpO2 output for any night with a warm-up placeholder. The two committed fixtures
   (`20260612`, `20260624`) appear clean/real-flat → likely EXPORT-INERT, but VERIFY: if either moves,
   **regenerate it** (re-run `OxyDex.compute` on its committed CSV + re-export, never hand-edit) and
   re-record `{manifestHash, inputHashes, outputHash}` in `FIXTURE-PROVENANCE.json`. The suite's
   `env.equiv.oxydex` leg is the enforcement — it must reproduce whatever export ships.
4. Stamp `Status: DONE — <date>` here only once both gates re-confirm. Spawn a FOLLOWUPS brief for any residue.

## Notes / decisions
- **Adaptive over fixed-window** (user-confirmed): the placeholder length varies per night (0/8/25 s);
  a fixed 2–5 s cut would miss the 25 s case and could clip real data on immediate-lock nights.
- **Tail:** this night's cool-down is `- -` rows (already dropped by `parseCSV`); the symmetric
  trailing guard is strict (requires an abrupt step INTO a frozen low placeholder) so genuine stable-
  sleep flat tails are kept. No positive frozen-cool-down example in the corpus yet — guard is
  belt-and-suspenders.
- **Not fabrication:** trimming a frozen non-signal edge block is the same class of action as the
  existing `- -` row skip; real samples are preserved, `t0Ms`/duration shift to the true signal start.
