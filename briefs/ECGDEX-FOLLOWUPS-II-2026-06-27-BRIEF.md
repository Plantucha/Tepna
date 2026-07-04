<!--
  ECGDEX-FOLLOWUPS-II-2026-06-27-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-06-30 (node-residue closeout — §3 keep-live-12e-gate + §4 keep-gated-static-coload DECIDED; §5 overnight-ECG orchestrate perf cap DEFERRED (conditional/LOW, not inert — no green-keeping DSP re-bundle); §6 live-drop + Node-CI standing debt; residue → NODE-RESIDUE-FOLLOWUPS-2026-06-30-BRIEF.md; prior progress: §1 STALL-RECOVERY + §2(a) rich-export + §2(b) companion-ingest + §7 cross-check ALL DONE 2026-06-27 — both gates green; §3 byte-fixture / §4 co-load-gen / §5 perf / §6 debt open) · **Created:** 2026-06-27 · **Follows:** ECGDEX-FOLLOWUPS-2026-06-27-BRIEF.md (executed/DONE 2026-06-27) · **Also-from:** ECG-RPEAK-SEED-FIX-2026-06-27-BRIEF.md (the §1 search-back item) · **Sibling-of:** PPGDEX-FOLLOWUPS-2026-06-27-BRIEF.md · GLUCODEX-FOLLOWUPS-2026-06-27-BRIEF.md · **⚠ Coordinate-with:** ECG-PPG-FOLLOWUPS-HANDOFF-2026-06-27-BRIEF.md — execute §2 here JOINTLY with PPGDEX-FOLLOWUPS §1 (one shared rich-export shape). Read the handoff first.

# ECGDex follow-ups, round II — residue deferred from the -I execution + the seed-fix pass

> **Read `CLAUDE.md` first** (the two gates, the Clock Contract, frozen `Ganglior`/`fascia`,
> edit-inputs-then-re-bundle). Then `ECGDEX-FOLLOWUPS-2026-06-27-BRIEF.md` (the parent, whose §1/§5
> DECISIONS this round IMPLEMENTS) and `ECG-RPEAK-SEED-FIX-2026-06-27-BRIEF.md` (whose follow-up §1
> below is the general case of the startup fix). Nothing here blocks anything shipped — the -I pass
> closed §2/§3/§4 and verified the interim light path is safe. All items are deliberate, gate-bearing
> passes.

## ✅ EXECUTION LOG — 2026-06-27 (§2 option (a), via ECG-PPG-FOLLOWUPS-HANDOFF §1; both gates green)

- **§2 (a) — DONE.** `ecgBuildNodeExport` gained an `opts.rich`-GATED block carrying exactly the slice the
  Integrator's `adaptEnvelopeNode('ECGDex')` reads: `hrv.time.{wholeRecordRMSSD/SDNN + epoch-median display
  + sdnnIndex}`, `hrv.frequency.lfhf`, `quality.analyzablePct`, `timeseries.epochs[].position`, and
  `sleep.stageMinutes` (field math MIRRORS `ecgdex-app.js buildV2` — same `analyze()` `r`, same numbers).
  Only `signal-orchestrate.emitEcgNodeExport` passes `rich:true`; the app's `exportGanglior()` does NOT, so
  the LIGHT Ganglior stream stays **BYTE-IDENTICAL**. Landed JOINTLY with `PPGDEX-FOLLOWUPS §1` under ONE
  shared rich-export shape (the handoff's no-divergence mandate). New Dex-Test-Suite group *"Integrator
  ingests the RICH ECGDex export"* (+ a PpgDex twin) locks: the default no-flag builder omits
  hrv/timeseries/quality/sleep; the rich export carries the consensus axis; `adaptEnvelopeNode` now picks up
  `summary.rmssd/sdnn` non-null (== `wholeRecordRMSSD`); the LIGHT export still degrades (rmssd null, never a
  fabricated 0); and `epochs[].position` wires to a posture series. ECGDex re-bundled external-JS-only
  `manifestHash bfa1aa934fcc→0aaaa23062d4` (buildHash `146ac9c8b1bd` UNCHANGED); `BUILD-MANIFEST.json` GATE A
  + the `ECGDex_2026-06-27_equiv` `FIXTURE-PROVENANCE.json` manifestHash updated (LIGHT fixture export-inert
  → NOT regenerated, only the producing-bundle hash re-recorded). Dex-Test-Suite all-green **1119/71**;
  verify-provenance GATE A 8/8 + GATE B reproducible.
- **§2 (b) — DONE 2026-06-27 (companion-bundle ingest; both gates green).** NEW DSP-resident
  `parseDeviceRR/parseDeviceHR/parseDeviceACC` in `ecgdex-dsp.js` (Clock-Contract-faithful regex
  `parseTimestamp`, mirroring PpgDex's `parseSensorXYZ/parseDevicePPI`); the polar-h10-ecg adapter parses the
  host-paired `*_RR/_HR/_ACC` sidecars from `ctx.companions` and attaches `frame.deviceRR/deviceHR/deviceACC`,
  so `compute()` runs `stampEpochPositions(deviceACC)` → REAL `epochs[].position` (posture) — filling the §2(a)
  scaffold (was all-'unknown' companion-less). The pairing is ONE shared helper
  (`signal-orchestrate.pairCompanions`, both hosts call it); landed JOINTLY with PPGDEX §1(b) (same mechanism).
  ECGDex re-bundled external-JS-only `da5134a91410→c8eb64808061` (buildHash UNCHANGED; equiv fixture
  export-inert → re-recorded). New Dex-Test-Suite group 'Companion-bundle ingest'; all-green **1158/75**;
  verify-provenance GATE A 8/8 + GATE B reproducible. Discovered residue: the hosts still gate LIVE emit to
  rr/spo2/hrv (ecg/ppg/cgm not live-emitted yet) — pre-existing, broader than (b); see the handoff.
- **§3 (committed event byte-fixture · optional) — DECIDED keep the live gate.** No committed `*_rich`
  byte-fixture added: the new live structural + Integrator-ingest groups, plus the `genSynthetic→compute`
  determinism already gated by 12e, cover the rich shape. Upgrade to a committed byte-diff only if that
  determinism check proves insufficient (same call as the §3 event-fixture decision).
- **§1 — DONE 2026-06-27 (STALL RECOVERY).** Implemented as a surgical **idle-decay**, NOT the full
  re-scan search-back the §1 spec prescribed — see §1 below for why (the full version recovered ~7% MORE
  beats on CLEAN records too, which would churn the differential-RR oracle + the equiv fixtures; idle-decay
  is byte-identical on clean data). Root-caused + empirically reproduced on the user's real
  `…20260625_215300_ECG` parts (a ~5 kµV settling transient → integ artifact ≈1.1e7 vs ~5e5 real QRS →
  63 beats / 4 min of a ~7 h record); the fix recovers 63→630 beats (full night). New regression group
  **12c2** (mid-record artifact; teeth: pre-guard ~14% recovery → ≥99% with the guard). ECGDex re-bundled
  external-JS-only `manifestHash 0aaaa23062d4→fea6fa9dc7f5` (buildHash `146ac9c8b1bd` UNCHANGED);
  Dex-Test-Suite all-green **1124/72**; verify-provenance GATE A 8/8 + GATE B `ECGDex_2026-06-27_equiv`
  reproducible (LIGHT clip export-inert → re-recorded, not regenerated). Newly-surfaced residue → §7.
- **§4 · §5 · §6 — OPEN.** Co-load generation step, overnight orchestrate perf cap, live-UI drop +
  Node-CI debt — untouched this pass.

## 1 · ✅ DONE 2026-06-27 — Pan-Tompkins STALL RECOVERY (general mid-file threshold-stuck case) — implemented as idle-decay

> **✅ EXECUTED 2026-06-27.** Confirmed by empirically reproducing the failure on the user's real
> `…20260625_215300_ECG` parts: the recording opens with a ~5 kµV electrode-settling transient that
> decays in ~30 s (clean QRS thereafter), but a sharp IN-BAND artifact in that window drives the SQUARED
> integrate to ≈1.1e7 (~33× the seed, ~21× the ~5e5 real QRS). `SPKI` climbs on it and — with no
> recovery — `THRI` parks above every later real QRS: `detectPeaks` on the real part-1 returns **63
> beats, last @238 s** (exactly the export's `beats:63 / spanMin:4`), then dead. The seed fix prevented
> the STARTUP throw but not this stall (it converted a loud throw into a SILENT 1-min truncation).
>
> **Implemented as idle-decay, NOT the full re-scan search-back the spec below prescribed.** The full
> Pan-Tompkins search-back (re-scan the gap at ≈0.5·THRI, register a sub-threshold candidate) was built
> and tested first: it recovers the night (676 beats) but is **+7% on CLEAN records** (426 vs 398 on a
> clean real slice) because it always re-scans for missed beats — which would move the differential-RR
> oracle (seed 3/5 ratio bands) and every ECGDex equiv fixture. The shipped fix instead **bleeds a
> stalled `SPKI` toward the noise floor only when detection has stalled past a non-physiologic gap**
> (`rrAvg>0 && (i-last) > 2.5 s ⇒ <24 bpm ⇒ the THRESHOLD, not the heart, is stuck` → `SPKI =
> Math.max(NPKI, SPKI*0.99)`). On clean records a real RR never exceeds 2.5 s, so the branch never fires
> and beat output is **byte-identical** (verified: real clean slice 398/398, synthetic 60 bpm 90/90 —
> hence zero fixture/oracle churn). It self-heals the same stuck-high `THRI` (startup OR mid-file). The
> gate is a NEW group **12c2** (a mid-record ±6 kµV artifact on scaled 600 µV synthetic) rather than
> extending 12c (which is specifically the startup-SEED test) — teeth: the pre-guard detector collapses
> to ~14%, the guard recovers ≥99%, plus a static assert that the `idleLimit`/`SPKI*0.99` guard exists.
> **Deferred (→ §7):** the in-stall beats (~the first lost minute) and the ~59 false transient beats are
> NOT recovered/removed — downstream SQI/Malik handles the few false beats; full re-scan search-back
> remains an option if in-stall recovery is ever wanted (at the cost of re-baselining the clean fixtures).

The seed fix made `detectPeaks` seed from a robust global percentile (`_seedScale`), which fixes the
**startup** electrode-settling case (the user's `…20260625_215300_ECG.txt`). It does **NOT** fix the
*general* recurrence: `SPKI` (and thus `THRI`) only decays **when a peak FIRES**, so a single large
**mid-record artifact** (electrode pop, motion burst) that passes threshold inflates `SPKI`, and a
following run of smaller real beats can fall below the inflated `THRI` and be missed until the next
large beat. The robust seed doesn't touch that. **Do:** add the canonical Pan-Tompkins **search-back** —
track the running mean RR; if no QRS is detected for > ~1.66× mean RR, re-scan that gap at a relaxed
threshold (`≈0.5·THRI`) and, if a qualifying peak is found, register it and update `SPKI` with the
search-back coefficient (so `THRI` relaxes back toward the noise floor). This self-heals ANY stuck-high
threshold (startup OR mid-file) and is the literature-standard completion. **Gate:** extend
`tests/dex-tests.js` group 12c with a mid-file artifact burst (inject a ~2 s high-amplitude span at
the record midpoint) and assert the beats AFTER it are still detected (count + HR continuity). DSP edit
→ re-bundle ECGDex + both gates; budget for the equiv fixture to stay inert (0-event clip) but RE-VERIFY.

## 2 · ⚠ §1 (companion-less + light orchestrate export) — IMPLEMENT, coordinated with PPGDEX §1

The parent -I DECIDED option **(a)** (richer gated export) and deferred the implementation because the
brief mandates aligning with `PPGDEX-FOLLOWUPS §1`, still undecided at -I time. **Do, as ONE coordinated
ECG+PPG pass:**
- **(a)** Teach `ecgBuildNodeExport`/`emitEcgNodeExport` to OPTIONALLY carry `hrv.time` (incl. the
  whole-record `wholeRecordRMSSD/SDNN` the Integrator's `adaptEnvelopeNode('ECGDex')` consensus axis
  reads), `timeseries.epochs[].position`, and `sleepStages` from the `analyze()` result `r`, gated
  behind an opts flag so the **app's light `exportGanglior` stays byte-identical** (app calls without
  the flag; only `emitEcgNodeExport` passes it). Then a Unifier/OverDex-routed ECG file gains HRV
  consensus + posture in fusion. Mirror the SAME shape in PpgDex so the two nodes don't diverge.
- **(b)** Device cross-checks need the COMPANION `*_RR/_HR/_ACC` files, which the single-text adapter
  boundary drops. Lift the app's `loadFiles` nearest-by-stamp pairing into a multi-file adapter entry
  (or pass siblings via `ctx`) so `rec.deviceRR/HR/ACC` are populated on the orchestrate path. Larger;
  may be its own sub-pass.
- **Gates:** (a) moves the orchestrate export → add an `env.equiv.ecgdex_rich` fixture OR assert the
  app light export is unchanged + the rich fields appear only via `emitEcgNodeExport`; re-bundle +
  GATE A/B. Verify `adaptEnvelopeNode('ECGDex')` now picks up rmssd/sdnn/posture (extend -I group 12d).

## 3 · §4 byte-coverage — upgrade the structural gate to a committed byte-fixture (optional)

-I §4 landed a STRUCTURAL + determinism event byte-shape gate (group 12e) — robust, closes the
"is the `sqi` axis / `meta` present and well-formed?" gap without a brittle committed fixture. The
STRONGER form the parent brief named is a committed `env.equiv.ecgdex_events` fixture byte-diffed in
both runners (like `hrvdex_events` / `pulsedex_events`). **Do (optional):** generate a deterministic
overnight `*_ECG.txt` (or `genSynthetic({durSec:≥2h})` rendered to the Polar layout) that emits ≥1
`autonomic_surge` + ≥1 `stage_*`, commit it + its export fixture, wire `env.equiv.ecgdex_events` into
both runners + a CASE. Only worth it if the determinism check in 12e proves insufficient.

## 4 · §5 — co-load manifest GENERATION step (maintainability)

-I DECIDED to keep the gated-static co-load list (safety met — a missed host is a RED). The full
reduction-to-one-edit needs the hosts (`Data Unifier.html`, `OverDex.html`, `Dex-Test-Suite.html`,
`tests/run-tests.mjs`, `tsconfig.json`) to GENERATE their adapter/DSP `<script>` tags / load arrays
from `dex-coload.js`. Touches critical load ORDERING in host pages → deliberate pass, **before/with
the CPAPDex leg** (so CPAPDex is the first node added via one edit). Decide generation vs keep-gated.

## 5 · §7 — full-overnight `*_ECG.txt` perf on the orchestrate path (perf, LOW)

A Unifier/OverDex-dropped overnight ECG runs the FULL `analyze()` synchronously on the main thread
(the orchestrate path has no Worker; ~millions of samples ≈ seconds). The app streams in a Worker.
**Do (LOW):** if overnight ECG via the Unifier matters, add a sample-cap / decimation guard to the
orchestrate `compute()` path (the app keeps the Worker). Inert for today's bounded callers (the 6-min
equiv clip). NB the seed fix's `_seedScale` adds one O(N) subsample+sort (~20 k cap) — negligible.

## 6 · §6 / §8 — standing verification debt (LOW, carry forward)

- **Live-UI drop-zone** (§6): a real Polar H10 `*_ECG.txt` (+ companions) dropped into the live Data
  Unifier / OverDex drop-zone → `polar-h10-ecg` → `emitEcgNodeExport` → renders an ECGDex summary was
  NOT exercised (cross-origin preview-sandbox limit). The headless path is gate-proven; this is
  confirmation, not discovery. Carry with the OxyDex/GlucoDex/PpgDex live-drop debt.
- **Node-CI** (§8): `node tests/run-tests.mjs` not runnable without a Node host this environment.
  ECGDex is wired into both runners (`env.ECGDSP`, `env.equiv.ecgdex`, the new 12c/12d/12e groups run
  in both). Run when a Node host is available. Same standing debt as the sibling briefs.

## 7 · ✅ DONE 2026-06-27 — Residue surfaced WHILE executing §1

> **✅ EXECUTED 2026-06-27 (both items; both gates green).** **(1) Cross-check panel reframed.**
> `validateHR` (DISPLAY-ONLY — not in any node-export) now excludes the ~60 s settling lead-in from the
> Pearson r and returns `rMeaningful=false` when HR was near-constant (smoothed SD<1.5 bpm) or the
> window <2 min; `renderHRValidation` demotes the HR-curve card to a SECONDARY check that links to the
> authoritative `validateRR` paired-RR card, renders `flat · n/a` instead of `weak` on a degenerate r,
> and adapts the HR-across-recording x-axis units (minutes for short clips — the fixed `/3600 h` had
> rendered a 6-min clip as a useless row of `0.0h`; the user's actual 7 h night was already fine). Card
> ORDER was already correct (`valCard` before `hrCard`), so this is framing + the r-verdict guard + the
> axis fix. **(2) Large-file blind spot closed.** `tests/dex-tests.js` group 12c2 gained a long-record
> FULL-coverage assertion (2 h synthetic: `coveragePct≥95` + `>3000` beats) — before this NO ≥2 h record
> was gated (the compute()≡export equiv fixtures are all ~6-min clips), which is exactly how the
> pre-stall-fix 1-min collapse slipped every gate. EXPORT-INERT (validateHR is render-only) → ECGDex
> re-bundled external-JS `manifestHash fea6fa9dc7f5→da5134a91410` (buildHash `146ac9c8b1bd` UNCHANGED);
> Dex-Test-Suite all-green **1125/72**; verify-provenance GATE A 8/8 + GATE B `ECGDex_2026-06-27_equiv`
> reproducible. **Watch (NOT fixed):** `_alignDevSeconds` falls back to the device's own first stamp
> when <50% of device rows overlap the ECG window — a real ECG↔companion `t0Ms` offset could still
> mis-align the overlay; left as-is (the Clock Contract keeps them consistent for one Polar capture).

- **The device HR cross-check panel is the weaker comparison.** Diagnosing this bug showed the on-screen
  "Device HR — Heart-Rate Cross-Check" is `validateHR` (`ecgdex-dsp.js`), which correlates two
  firmware-SMOOTHED HR *curves*; on a short / near-constant / settling-dominated window its Pearson r is
  a near-meaningless statistic (the user saw r=0.137 "weak/off" — a statistic artifact, NOT bad
  processing). ECGDex ALREADY has the rigorous test — `validateRR` (beat-to-beat PAIRED RR, Malik-
  corrected, used in `cohort-worker.js`). **Do (gated node pass):** make `validateRR` the HEADLINE
  device cross-check, demote `validateHR` to a secondary trend overlay, guard its r/verdict on
  degenerate windows (too-short / near-constant → "insufficient range") + exclude the settling lead-in,
  and adapt the HR-across-recording x-axis units for short clips (it rendered all `0.0h`). Now relevant
  because the §1 fix means there's a FULL night of RR to compare against.
- **The `compute()≡app-export` equivalence gate is large-file-blind.** It uses ~6-min fixtures, so no
  large / multi-part / settling-transient file is ever exercised — this whole class (the user's ~7 h
  recording) slipped every gate. **Do (gated test work):** add a long / multi-part / transient-bearing
  coverage case (e.g. the committed `…20260617…_ECG_part0*` clip, or a `genSynthetic(durSec≥2h)` with a
  prepended transient) so detection-coverage on a realistic night is gated, not just a clean 6-min clip.

### Priority summary
- **⚠ DSP / correctness:** §1 (Pan-Tompkins search-back — general threshold-stuck case; the seed fix
  only covered startup), §2 (implement the -I §1 (a)+(b) decision, coordinated with PPGDEX §1).
- **⚠ before / with CPAPDex:** §4 (co-load generation step).
- **LOW / debt:** §3 (committed event byte-fixture upgrade), §5 (overnight orchestrate perf cap),
  §6 (live-UI drop + Node-CI).
