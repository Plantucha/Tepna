<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** AUDIT FINDINGS (deep-correctness pass per `AUDIT-PROMPT.md`) · **Created:** 2026-07-01 · **Auditor:** AI agent · **Method:** invariant + counterexample, differential, live-module re-run in a sandbox realm · **Follows:** [`DEEP-AUDIT-FINDINGS-2026-06-30.md`](DEEP-AUDIT-FINDINGS-2026-06-30.md) · **Executed-by:** [`DEEP-AUDIT-FIXES-2026-07-01-BRIEF.md`](../briefs/DEEP-AUDIT-FIXES-2026-07-01-BRIEF.md) — both findings **DONE 2026-07-01** (both gates green; residue → `DEEP-AUDIT-FIXES-FOLLOWUPS-2026-07-01-BRIEF.md`)

# Deep-audit findings — Tepna Dex suite (2026-07-01)

Executed the `AUDIT-PROMPT.md` MISSION. Established a green baseline by **re-running the real modules
and the real gate cores** (not by trusting the pill), then hunted the 10 bug classes, weighting
**"plausible but wrong number"** highest. The suite remains in genuinely strong shape — the high-fear
classes are correct and gated, and the 2026-06-30 pass already closed the biggest items (the PulseDex
`spectral()` proxy was **removed**, the ECGDex `Date.now()` event fabrication is **fixed**). This pass
found **two residues both OUTSIDE the prior clean-ledger**: one MED fabricated-absence in HRVDex's
*transparent* HRV columns (the prior pass gated only the *subjective* composites), and one LOW–MED
Clock-Contract / parser-divergence in ECGDex's device cross-check loaders (the prior pass verified only
the DSP `parseTimestamp`, not the app copy).

---

## Finding 0 — Baseline gate state (the mission's mandated finding #1)

**Both gates GREEN — verified by re-computation, not by reading the pill.**

- **Provenance (`verify-provenance.html` core, via `manifest-gate.js`):** recomputed every bundle's
  live `manifestHash` and ran GATE A + GATE B in a sandbox realm. **GATE A 8/8 match**
  `BUILD-MANIFEST.json` (`ECGDex 39388acbc7dd · OxyDex e2ec6294e1ad · PulseDex 3ab7dde7eb08 · GlucoDex
  25eaee49bd19 · PpgDex 0e0d255186c7 · HRVDex 6c4a8930b1cb · CPAPDex b4f063b3da7c · Integrator
  2ba8d6a61cb8`). **GATE B 15/15 reproducible, 0 drift, 0 skipped** (uploads/ present in this
  environment, so every code-gated fixture's input+output+manifestHash triple was fully verified).
  `__provenanceOK` ≡ **true**.
- **Behavior (`Dex-Test-Suite.html` headless floor, via `tests/dex-tests.js` + the real modules):** all
  44 modules load with **zero** load/eval errors; every assertion executed passed (cohesion-badges
  60/60; ECGDex respRate 4/4; the cheap-group mass green under a full `env`). Render-coverage +
  synthetic-heavy legs (genSynthetic full-night rigs) were not exhaustively run in the sandbox (they
  are DOM/iframe- and CPU-bound — one group alone took ~11 s for 4 passing assertions in the slow
  sandbox), but the ones spot-checked pass and GATE B independently confirms current code identity
  reproduces every committed export. **No red before touching anything.**

---

## HRVDex

### Finding 1 — transparent HRV columns fabricate a `0` for an absent vendor cell (fabricated absence)

- **Severity:** **MED** — *fabricated absence* (class #3): a missing measurement becomes a number, not
  `null`. It reaches a surfaced derived value (the rolling SDNN z-score) under a partial-file trigger.
  Not top-tier only because complete Welltory exports (the common case) carry these columns, so the
  wrong number requires a row with a **blank core cell**.
- **Symptom:** In the HRV-summary parser, a blank/absent transparent column
  (`SDNN`/`rMSSD`/`Mean RR`/`pNN50`/`MxDMn`/…) is parsed to a fabricated **`0`**, not `null`. The row
  still enters `allRows` (push is gated only on a finite timestamp), and a fabricated `_sdnn=0` then
  **pollutes the 7-day rolling SDNN baseline** because the SDNN rolling filter keeps `0` while its
  rMSSD twin drops it — biasing `d_sdnn_z` for every row in the window.
- **Reproduction (re-run of the real `HRVDex.parseRows`):** a 3-row Welltory-shaped CSV whose middle
  row has blank `SDNN,rMSSD,pNN50,Stress,Energy`:
  ```
  Date,Time,Measurement HR,Mean RR,SDNN,rMSSD,MxDMn,pNN50,AMo50,Mode,Stress(HRV),Energy(HRV)
  2026-06-01,07:00:00,58,1030,62,45,320,28,38,1020,40,60
  2026-06-02,07:00:00,60,1000,,,300,,39,1000,,
  2026-06-03,07:00:00,57,1040,68,50,330,31,37,1030,42,58
  ```
  `HRVDex.parseRows(csv)` → **3 rows** (all pushed; row 2 kept on timestamp alone), and row 2 reads
  **`_sdnn=0, _rmssd=0, _pnn50=0`** — the contract expectation for an absent cell is `null`. Applying
  the two real rolling filters to the parsed `_sdnn` column: the SDNN filter (`!isNaN`, `hrvdex-dsp.js`
  ~:577) keeps `[62, 0, 68]` → mean **43.3**; the rMSSD-style filter (`!isNaN && v>0`, ~:576) would
  give `[62, 68]` → mean **65.0**. The fabricated `0` moves the SDNN baseline **~33 %**. (Suggested
  gate assertion: `parseRows` on a blank-`SDNN` row → `_sdnn == null` **and** that row is excluded from
  `meanSDNN7`/`stdSDNN7`.)
- **Root cause:** `hrvdex-dsp.js:123-140` — `r._sdnn = parseFloat(r['SDNN']||0)` (and the sibling
  `_meanRR/_rmssd/_mxdmn/_pnn50/…` lines): an empty string `|| 0` → `parseFloat(0)` → `0`. Row push is
  gated only on `isFinite(r._tMs)` (`:141`). Downstream the guard is **asymmetric**: `rmssd7` filters
  `!isNaN(v) && v>0` (`:576`) — correctly dropping the fake `0` — but `sdnn7` filters only `!isNaN(v)`
  (`:577`), so the fake `0` flows into `meanSDNN7`/`stdSDNN7` (`:588-589`) → `d_sdnn_z` (`:590`). The
  `_hasSubj` zero-seed gate (`:354`) that the WELLTORY-COMPOSITES-ENDGAME quarantine relies on covers
  ONLY the six **subjective** columns (`_stress/_energy/_focus/_coherence/_sns/_psns`); the
  **transparent** columns are ungated — which is why this sits outside both that quarantine and the
  2026-06-30 clean-ledger (its class-#3 entry checked the composites + adapter seeding, not the
  raw-CSV parse layer). Same-row derived metrics `d_cv_calc`/`d_rmssd_sdnn` (`:356-357`) DO guard
  `_sdnn` truthiness (`0 → NaN`, safe); the un-guarded leak is specifically the rolling baseline.
- **Fix sketch + gate cost (one gated change):**
  - Parse an absent/blank transparent cell to **`null`**, not `0` — e.g. a `numOrNull(cell)` helper
    (empty/non-finite → `null`) replacing the `||0` on the transparent lines. Persistence already
    tolerates it: `_hrvNum` (`:161`) maps a non-number to `''`, so `null` round-trips through
    `HRV_SEED_FIELDS`. Keep the **subjective** seeds at `0` for `_hasSubj` back-compat (or migrate them
    to the same `null` + presence-gate — separate decision).
  - Make the rolling filters symmetric (SDNN filter drops non-finite/≤0 like the rMSSD twin), and gate
    any *surfaced* transparent metric on presence.
  - **Gate cost:** edits `hrvdex-dsp.js` (DSP) → **re-bundle HRVDex** → **GATE A** `manifestHash` bump
    in `BUILD-MANIFEST.json`. **Likely export-inert:** the committed `hrvdex` equiv fixtures use
    COMPLETE Welltory rows (no blank core cells), so `compute()≡export` should stay byte-identical —
    re-record `manifestHash` only, **verify by re-running the equiv leg** (if any committed row has a
    blank core cell it must regenerate). Add the regression assertion above to `tests/dex-tests.js`.

---

## ECGDex

### Finding 2 — device cross-check loaders use forbidden `Date.parse` + `_floatNow()`, diverging from the Clock-Contract-faithful DSP twins

- **Severity:** **LOW–MED** — *contract/provenance drift* (Clock Contract §2 rule 4 + §2.6) **plus**
  differential drift (two parsers for one vendor format). The path is **display-only** (device
  cross-check panel; not in any `ganglior.node-export`), and every consumer self-relativizes, so the
  surfaced RR-validation numbers are largely protected — but it introduces **viewer-timezone-dependent**
  behavior in the HR-alignment window and a live app-vs-orchestrate parser divergence.
- **Symptom:** ECGDex's UI device cross-check loaders parse vendor timestamps with **`Date.parse()`**
  (forbidden — locale/implementation- and viewer-timezone-dependent) and `loadDeviceHR` **fabricates
  `_floatNow()`** for a stampless row — while the contract-faithful DSP twins
  (`ECGDSP.parseDeviceRR/parseDeviceHR/parseDeviceACC`, which use the regex `parseTimestamp` and keep a
  missing stamp `null`) already exist and are the ones the Unifier/OverDex adapter path uses. The **same
  `*_RR/_HR/_ACC` file** therefore parses to a different `tsMs` depending on entry path (ECGDex UI vs
  routed) and on the viewer's timezone.
- **Reproduction:** `parseTimestamp('2026-06-13 20:44:48').tMs` is a fixed floating `Date.UTC(...)`
  (viewer-TZ-independent, per the Clock Contract); `Date.parse('2026-06-13 20:44:48')` returns a
  real-UTC instant that shifts by the viewer's tz offset. So the app loader's `tsMs` differs from the
  DSP twin's by `tzOffset`, and `validateHR`'s window test `(tsMs − ecgT0Ms) ∈ [−2, durSec+2]`
  (`ecgdex-dsp.js:1375`) **passes for a UTC viewer but fails for a UTC+2 viewer** (→ silently falls back
  to `base = rows[0].tsMs`, self-relative) — i.e. re-render under a changed `TZ` is **not** identical
  (charter bug class #2). (Suggested gate assertion: the app device-RR parse ≡ `ECGDSP.parseDeviceRR`
  on the same text, and each `tsMs` is viewer-TZ-invariant.)
- **Root cause:** `ecgdex-app.js:179-189` `parseRows` (`Date.parse(p[0])` at `:183` header-sniff and
  `:185`), `:210` `loadDeviceHR` `… : _floatNow())+s*1000` fallback, `:89` `_floatNow`. The
  contract-faithful twins live at `ecgdex-dsp.js:1813-1854` (`parseTimestamp`; `null` stays `null`;
  stampless ACC relative-rebased, never `now()`) and are consumed by `adapters/polar-h10-ecg.js:116-121`
  (the routed path). The app UI file-inputs (`:1624-1626`) and the app's own companion-lane loader
  (`:1190`) call the **app** copy. The divergence is *acknowledged* in `ecgdex-dsp.js:1804-1807` (the
  DSP parsers are described as "the PURE headless mirrors" of the app's `Date.parse`/`now()` loaders)
  but is **not** tracked as a fix-item. `validateRR` (`:1347-1361`) uses only RR **values** (tsMs-free
  → its surfaced numbers are safe); `validateHR`/`alignACC` self-relativize when the absolute offset is
  out of range, which masks the frame mismatch at the cost of TZ-dependent alignment.
- **Fix sketch + gate cost (one gated change):** point the app loaders at the DSP twins
  (`ECGDSP.parseDeviceRR/parseDeviceHR/parseDeviceACC`) and delete `parseRows` + the `Date.parse` /
  `_floatNow` copies — collapsing to the single Clock-Contract-faithful parser the code already calls
  the canonical one. Behavior-preserving for the correctly-stamped UTC-viewer case; removes the
  TZ-dependence and the stampless fabrication. **Gate cost:** edits `ecgdex-app.js` only → **re-bundle
  ECGDex** → **GATE A** `manifestHash` bump. **Export-inert** (the cross-check is display-only, absent
  from `buildNodeExport` — `BUILD-MANIFEST.json`'s ECG cross-check note confirms `validateHR` is
  DISPLAY-ONLY), so the `ecgdex` equiv fixture stays byte-identical → re-record `manifestHash`, no
  regen. Add the parity + TZ-invariance assertion above.

---

## Verified clean (checked this pass — do not re-spend effort)

- **Units mandate (class #1):** `DexProfile` stores/computes **metric**; `toDisp`/`toMetric` +
  `Quantity` convert only at the boundary; `setManual` takes metric; gate-tested
  (`tests/dex-tests.js:4134-4138`, `:4587-4589`). No persisted imperial value found. GlucoDex mg/dL is
  the CGM-consensus-native metric unit (prior Finding 3; the mmol/L display toggle since shipped).
- **`std()` / SDNN unification (class #5):** all four shipped HRV paths use **sample SD ÷(N−1)**
  consistently (`ecgdex-dsp:25`, `pulsedex-dsp:87`, `hrvdex-dsp:635`, `ppgdex-cross:28`,
  `pulsedex-cross:29`), each with an explicit "÷N−1 Task Force" comment; `rmssd` divides by the number
  of successive differences (correct). Population-SD variants are confined to non-cross-node surfaces
  (`ecgdex-morph` QRS template, `oxydex` sampEn tolerance) — intentional. Corroborates the 2026-06-30
  ledger.
- **Spectral honesty (class #6):** the crude `spectral()` / `hf≈rmssd²` proxy is **removed**
  (`pulsedex-dsp.js:102`, DEEP-AUDIT-FIXES §1, 2026-06-30); cross-node `frequency:{…}` is Lomb–Scargle.
- **ECGDex stampless events (class #2/#3):** the old `rec.t0Ms||Date.now()` fabrication is **fixed** —
  `ecgdex-dsp.js:1271` threads `rec.t0Ms!=null?rec.t0Ms:null` (Clock §2.6), `:1331` `t0Ms: rec.t0Ms ||
  null`; the "null clock, never now()" gate group passes.
- **Silent fallbacks (class #4):** every `catch(_){}` / `catch(e){}` reviewed is a benign guard around
  non-critical DOM/storage/worker ops (theme toggle, `localStorage`, `worker.terminate`,
  `MutationObserver.disconnect`, print-media listener, optional-module load) — none swallow a DSP
  failure.
- **Provenance (class #9):** re-computed clean (see Finding 0).

---

## Prioritized punch-list (correctness first)

1. **Finding 1 (MED, real) — ✅ EXECUTED 2026-07-01:** HRVDex transparent columns fabricate `0` for an absent cell; the fake `0`
   pollutes the rolling SDNN baseline (`sdnn7` `!isNaN`-only filter vs `rmssd7` `>0`). Parse absent →
   `null`; make the SDNN rolling filter symmetric. One gated HRVDex re-bundle; likely export-inert
   (verify equiv leg).
2. **Finding 2 (LOW–MED) — ✅ EXECUTED 2026-07-01:** ECGDex device cross-check loaders use `Date.parse` + `_floatNow()`,
   diverging from the Clock-Contract-faithful `ECGDSP.parseDevice*` twins → viewer-TZ-dependent HR
   alignment. Point the app loaders at the DSP twins; delete the app copies. One gated ECGDex re-bundle;
   export-inert.

*Per the charter + `CLAUDE.md` brief-lifecycle: both findings were accepted and executed in
[`DEEP-AUDIT-FIXES-2026-07-01-BRIEF.md`](../briefs/DEEP-AUDIT-FIXES-2026-07-01-BRIEF.md) (Status DONE — 2026-07-01;
HRVDex `manifestHash 6c4a8930b1cb→00578ca08503`, ECGDex `39388acbc7dd→ede9e04831c8`, both EXPORT-INERT;
GATE A 8/8 + GATE B 15/15 reproducible; headless behavior floor green with the two new regression
groups). Residue captured in [`DEEP-AUDIT-FIXES-FOLLOWUPS-2026-07-01-BRIEF.md`](../briefs/DEEP-AUDIT-FIXES-FOLLOWUPS-2026-07-01-BRIEF.md).*
