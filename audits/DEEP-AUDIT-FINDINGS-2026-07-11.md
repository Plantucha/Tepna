<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** AUDIT FINDINGS (independent deep-correctness pass per `AUDIT-PROMPT.md`) · **Created:** 2026-07-11 · **Auditor:** AI agent (independent re-run) · **Method:** green baseline by re-computation → invariant + counterexample, differential across redundant paths, dimensional pass at every I/O boundary, end-to-end trace of a committed real export · **Follows:** [`DEEP-AUDIT-FINDINGS-2026-07-01.md`](DEEP-AUDIT-FINDINGS-2026-07-01.md) · **Comparison to the prior ledger:** §Comparison below

# Independent deep-audit findings — Tepna Dex suite (2026-07-11)

Ran the `AUDIT-PROMPT.md` MISSION as an **independent** pass (findings first, then compared against the
existing audit ledger — see §Comparison). Established a green baseline by re-computation, then hunted the 10
bug classes weighting **"plausible but wrong number"** highest. The suite remains in genuinely strong shape:
the two historically-feared classes are clean and gated (SDNN `÷(N−1)` unified across all four HRV paths; **no**
surfaced spectral proxy — Lomb–Scargle everywhere, gate-locked), the Clock Contract is well-enforced, and no
units slip mis-states a headline number (~100 boundaries traced). This pass surfaced **6 new findings** (2 that
reach a *surfaced* number, 1 security sink, 1 contract-drift, 2 low) plus several **latent hypotheses** — all
**outside** the prior clean-ledgers, each with a reproduction.

---

## Finding 0 — Baseline gate state (mandated finding #1)

**Both gates GREEN — verified by re-computation, not by reading the pill.**
- **Behavior:** `node tests/run-tests.mjs` exits 0 (headless floor green; both runs).
- **Provenance:** `node tests/verify-manifest.mjs` → **GATE A 8/8 bundles match** `BUILD-MANIFEST.json`; **GATE B
  3 reproducible / 0 drift** (13 code-gated fixtures skip because their raw `uploads/` inputs are gitignored in
  this checkout — an environment limitation, not a drift). No red before touching anything.
- **End-to-end clock trace:** committed exports decode under `getUTC*` to exactly their stated wall-clock —
  OxyDex `t0Ms 1781305216000 → 2026-06-12 23:00:16` (matches the file's `start`/`date`); PulseDex
  `startEpochMs → 2026-06-13 20:44:49`. Floating-clock model holds through the export boundary.

---

## GlucoDex

### Finding 1 — meal label → `innerHTML` XSS (stored **and** file-derived); realizes the prior audit's untraced hypothesis
- **Severity:** **MED** — *security-of-processing*. Same class as the fixed **F1/F2** (untrusted string →
  `innerHTML`), but in **GlucoDex, which Security Phase A never touched** — its shell does not even load the
  shared `dex-escape.js`, and the node does no HTML-escaping anywhere.
- **Symptom:** `glucodex-app.js:1048` renders `<span class="mr-label">${m.label||'(meal)'}</span>` into
  `innerHTML` (meal-list), and `:473` renders `${m.label}` into the postprandial card — **unescaped**. `m.label`
  comes from **two untrusted sources**:
  1. **User free-text (stored):** `addMeal()` (`:1052`) reads `$('mealLabel').value.trim()`, pushes it as
     `label` (`:1053`), and `saveMeals()` persists `MEALS` to `localStorage['glucodex_meals']` (`:20`). The
     payload re-executes on **every subsequent visit** (`renderMealList` runs on load) → **stored XSS**.
  2. **Parsed nutrition CSV (file-derived):** `DSP.parseNutrition` (`glucodex-dsp.js:984`) sets
     `label:(cells[ci.group]||'Meal')` straight from the CSV's group column; `:528` maps that into `MEALS`. A
     crafted Cronometer-style export with a group cell `<img src=x onerror=…>` injects when the meal list
     renders.
- **Reproduction:** type a meal label `<img src=x onerror=alert(document.title)>` (or import a nutrition CSV
  whose group column carries it) → it renders as live markup in `#mealList`, and (for the typed case) again on
  the next page load from `localStorage`. XSS runs in the origin that holds the shared profile + the Integrator
  IndexedDB longitudinal store.
- **Root cause:** `glucodex-app.js:1048` / `:473` interpolate `m.label` into `innerHTML` with no escaping;
  `GlucoDex.src.html` does not load `dex-escape.js` (only `OxyDex.src.html:3772` and `PulseDex.src.html:2828`
  do). The 2026-07-01 privacy audit flagged `glucodex_meals` free-text and "CSV field values → `innerHTML`
  beyond the filename" only as **untraced hypotheses** — this traces both to a live sink.
- **Fix sketch + gate cost (one gated change):** add `<script src="dex-escape.js"></script>` to
  `GlucoDex.src.html` (before `glucodex-app.js`) and wrap `escapeHTML(m.label)` at `:1048` and `:473` (and any
  other file/user-derived value reaching `innerHTML` — audit `res.error`/notes generally). Edits
  `glucodex-app.js` + the shell → **re-bundle GlucoDex** → **GATE A** `manifestHash` bump. Display-only,
  `compute()`/export untouched → **EXPORT-INERT** (both GlucoDex code-gated fixtures re-record `manifestHash`
  only). Add a source-mirror assertion that `m.label` is escaped.

---

## OxyDex

### Finding 2 — "Readiness" SpO₂ subscore fabricates the **best** bucket (25/25) on absent hypoxia inputs (fabricated absence)
- **Severity:** **MED (latent)** — *fabricated absence* (class #3): a missing measurement becomes the most
  favorable number and reaches a surfaced hero (`#sec-readiness`, `oxydex-registry.js:136`, grade
  `experimental`, unit `%`). Latent because it is only reachable via the recompute/reload path, not the primary
  compute.
- **Symptom:** `computeKarvonenZones` sums five subscores into a 0–100 Readiness. The SpO₂/hypoxia subscore is
  ungated: `var odi4Rate = odi4 ? odi4.rate : 0;` and `var hd94Rate = hypDose ? hypDose.hd94PerHr : 0;`
  (`oxydex-dsp.js:4904-4905`), then `if (odi4Rate < 2 && hd94Rate < 30) spo2Score = 25;` (`:4906`). So **absent**
  desaturation analysis (0/0) lands in the *best* bucket — "excellent, zero hypoxic burden" — indistinguishable
  from a genuinely clean night. The composite is gated only on `if (!hrv) return null` (`:4821`), never on the
  hypoxia inputs. (Sibling neutral-seeds: `stageProxy` absent → `+5` (`:4927`); `hrv.hrSlope==null` → `5`
  (`:4947`) — lower stakes.)
- **Reachability / trigger:** the primary path (`oxydex-dsp.js:2266`) always has `odi4` (`detectODI`) and
  `hypDose` (`computeHypoxicDose`) as objects, so a *measured* `rate=0` legitimately earns the max there. The
  fabrication is reachable through the **profile-recompute path** `oxydex-profile.js:516-519` —
  `computeKarvonenZones(null, n.hrv, …, n.odi4, n.hypDose, …)` reads `n.odi4`/`n.hypDose` off a **stored** night;
  a night missing those fields (schema drift / partial import) yields a fabricated 25/25 and a plausibly-high
  readiness. The in-code comment "pass null rows — guard allows it now" confirms the null-input path is
  deliberately supported. CONFIRMED pattern; live trigger HYPOTHESIS (needs a stored night lacking `odi4`).
- **Fix sketch + gate cost:** gate the SpO₂ subscore on presence — `if (!odi4 || !hypDose) spo2Score = null;` and
  either surface Readiness as `{usable:false, reason:'hypoxia inputs absent'}` or omit/flag the subscore rather
  than folding a fabricated 25 into the sum. Edits `oxydex-dsp.js` → **re-bundle OxyDex** → GATE A; verify the
  equiv leg (likely export-inert — committed OxyDex fixtures carry full hypoxia inputs). Add a regression
  assertion.

---

## ECGDex

### Finding 3 — `validateRR` corrects the two RR series with **different** bounds (2200 vs 2000), breaking its own documented "apples-to-apples" invariant
- **Severity:** **MED** — *mis-states a surfaced number* (the device cross-check panel's `dRMSSD`/`dSDNN`). The
  path is display-only (not in `ganglior.node-export`), so exports/fusion are unaffected — but a user-facing
  number is wrong in a specific band.
- **Symptom:** `_malikCorrect` (`ecgdex-dsp.js:1298 & 1300`) uses an upper plausibility bound of **2200 ms**;
  `buildNN` (`:540 & 544`) uses **2000 ms**. The `validateRR` header comment (`:1292-1294`) explicitly promises
  "*the same rule buildNN now applies to selfNN … so the comparison is corrected-vs-corrected
  (apples-to-apples)*." The bounds differ, so the promise is false for beats in **[2000, 2200] ms** that sit
  within 20 % of their local median (sustained sinus bradycardia below ~35 bpm).
- **Reproduction:** device RR `[1800, 1850, 1800, 2060, 1820, 1800, 2050, 1810]` (local median ≈ 1810;
  `|2050−1810|/1810 ≈ 13 % < 20 %`, so the deviation gate does not fire). `_malikCorrect` keeps 2050/2060
  (`< 2200`); `buildNN` on the same beats replaces them (`> 2000`) with the local median → `devRMSSD/devSDNN`
  retain the ~250 ms swings while `selfRMSSD/selfSDNN` are flattened → `validateRR` reports a **false
  self-vs-device mismatch** (`dRMSSD`, `:1314`) — precisely the artifact the function exists to prevent,
  reintroduced in the [2000, 2200] band. CONFIRMED by tracing both paths.
- **Fix sketch + gate cost:** align `_malikCorrect`'s bound to `buildNN`'s 300–2000 (or unify both — see Finding
  5). Edits `ecgdex-dsp.js` → **re-bundle ECGDex** → GATE A; display-only → likely export-inert (verify equiv
  leg). Add a differential assertion (below).

---

## Integrator ↔ ECGDex contract

### Finding 4 — the ECGDex fields the Integrator fuses (`apnea`, `hrvStability`) are emitted by **no** shared/automated export path → autonomic-slope + apnea authority silently `null`
- **Severity:** **MED** — *contract drift* (class #8). Degradation is honest (`null`, not a fabricated number),
  but which fusion legs light up is **route/button-dependent**, and no gate covers it.
- **Symptom:** `adaptEnvelopeNode('ECGDex')` reads `json.hrvStability.mean_lnRMSSD_slope` (`integrator-dsp.js:188`
  → `fuseAutonomicGlycemic` rule 3, `:936`) and `json.apnea.cvhrIndex` / `json.apnea.estimatedAHI.value`
  (`:196-197` → apnea authority). But the **shared** builder `ecgBuildNodeExport` (`ecgdex-dsp.js:1823`), even in
  its `opts.rich` branch (`:1853`), emits only `quality`/`hrv`/`timeseries`/`sleepStages` — **not** `apnea`,
  **not** `hrvStability`. Only the separate **"Export JSON"** button (`ecgdex-app.js buildV2`, `:1404`) emits
  them (`:1478-1496`). The automated pipeline (Unifier→OverDex→Integrator via `signal-orchestrate.js:209`,
  `rich:true`) and the app's own **"Ganglior → drop into Integrator"** button (`exportGanglior`, `:1627`, which
  omits even `rich`) therefore both carry `hrvStability=undefined` / `apnea=undefined`.
- **Consequence:** an ECG file fused through the pipeline or the fusion-labeled button has
  `summary.autonomicInstabilitySlope`, `summary.cvhrIndex`, `summary.estAHI` **always null** even though ECGDex
  computed a valid `mean_lnRMSSD_slope`/CVHR — `fuseAutonomicGlycemic` falls to its null branch (`:960-968`), and
  (via the light "Ganglior" button) ECG is dropped from the HRV consensus too. **Why the gates miss it:** the
  equiv gate re-runs `compute()`, whose export also omits these fields, so the fixture matches; the Integrator
  tests at `tests/dex-tests.js:5202/:5220` hand-craft an inline `apnea` object rather than asserting a *real*
  ECGDex export carries one.
- **Reproduction:** route a real ECG recording through OverDex→Integrator (or use the app "Ganglior" button) and
  inspect the fused summary → `autonomicInstabilitySlope`/`estAHI` null despite a non-trivial ECG HRV/CVHR
  result. Contrast with the same file exported via "Export JSON" (fields present).
- **Fix sketch + gate cost:** extend `ecgBuildNodeExport`'s rich branch to carry `apnea` + `hrvStability` (+ the
  whole-record `hrv` slice) mirroring `buildV2`, so `emitEcgNodeExport`/`exportGanglior` feed fusion — **or**, if
  light-by-design, have the Integrator emit a visible warning when an ECGDex rec has events but null
  `hrv`/`apnea`/slope, and add an assertion pinning the intended feed. Edits `ecgdex-dsp.js` (+ maybe
  `signal-orchestrate.js`) → **re-bundle ECGDex**; regenerate ECGDex fixtures only if `compute()` output bytes
  move.

---

## Cross-node / lower severity

### Finding 5 — RR-plausibility upper bound diverges across nodes (PulseDex 2200 vs ECGDex/PpgDex 2000), undocumented
- **Severity:** **LOW** — differential drift (class #5). PulseDex `artifactClean` (`pulsedex-dsp.js:415`,
  `>2200`) keeps genuine intervals in [2000, 2200] ms that ECGDex `buildNN` (`ecgdex-dsp.js:544`, `>2000`) and
  PpgDex `correctRR` (`ppgdex-dsp.js:379`, `>2000`) replace → surfaced SDNN/rMSSD diverge between nodes on the
  same sub-35-bpm bradycardia truth. Unlike PpgDex's **documented** 0.30 ectopy threshold, this upper-bound
  difference carries no cross-node rationale. Same reproduction array as Finding 3. CONFIRMED. Fix: pick one
  bound fleet-wide (reconcile with Finding 3) + add a differential test feeding a sub-35-bpm array to
  `PulseDex.compute` and `ECGDex buildNN` asserting SDNN/rMSSD agree.

### Finding 6 — `SignalSpec.cgm.unit` declared `mmol/L` but every CGM frame carries `mg/dL` (label vs reality)
- **Severity:** **LOW** — contract/label drift, benign today. `signal-spec.js:46` hardcodes `unit:'mmol/L'`,
  but `adapters/libre-cgm.js:96-104` builds `samples[].v` in mg/dL and GlucoDex computes in mg/dL throughout.
  The only consumers of `SignalSpec.unitOf('cgm')` are display-only (`signal-frame.js:296 describeFrame`,
  `data-unifier-app.js:112` label), so no math is wrong — but it is a declared-canonical-vs-actual mismatch and
  a landmine for any future consumer that trusts the spec unit for arithmetic. (GlucoDex's internal mg/dL
  normalization is intentional + test-locked — do **not** "fix" that; only the spec string is inconsistent.)
  Fix: set `signal-spec.js` cgm `unit:'mg/dL'` (or make `unitOf` reflect the frame's own `unit`).

---

## Hypotheses (unproven / latent — labelled, not reachable in production today)
- **HRVDex carried fields emit `0`, not `null`, on absent source** (`hrvdex-dsp.js:757-758`): `_envToSeed`'s
  `n(v)=finite?v:0` coerces absent envelope fields, then `hr:r._hr, sdnn:r._sdnn, rmssd:r._rmssd` emit them
  verbatim — an absent SDNN surfaces as `sdnn:0`, contradicting the adjacent comment "Transparent fields stay
  null when absent" (`:751`). The *composites* block (`:761-765`) is correctly `>0`-gated, so only the raw
  carried fields fabricate. Trigger: re-ingesting a partial `ganglior.node-export`/Welltory envelope lacking
  SDNN/HR. (Same class as the 2026-07-01 Finding 1, one layer over — the *carried* fields vs the *rolling*
  baseline.)
- **HRVDex `meanRR_s` outside the Baevsky guard** (`hrvdex-dsp.js:378, 385`): the guard normalizes Mode/MxDMn
  ms→s, but `d_csi = _mxdmnS / meanRR_s` and `d_cvi = log10(rmssd·meanRR)` assume Mean RR is ms **unguarded** —
  a vendor exporting Mean RR in seconds would inflate `d_csi` ~1000×. Not reachable with normal Welltory files
  (all ms). Asymmetry worth closing since the ms/s ambiguity was deemed worth guarding for the siblings.
- **HRVDex `d_csi` fallback ms/s mismatch when `DexUnits` absent** (`hrvdex-dsp.js:385`): the else-branch yields
  `_mxdmn` (ms) over `meanRR_s` (s) — a 1000× mismatch, only if `quantity.js` is not co-loaded (unreachable in a
  real bundle). One-line defensive fix (`r._mxdmn/1000`).
- **OxyDex 1-Hz-proxy Poincaré divisor mix** (`oxydex-dsp.js:4268` `÷m` population for `sdnn2` vs `:4274`
  `÷(m−1)` for `rmssd2`, combined in `sd2` at `:4277`): a `÷N`/`÷(N−1)` inconsistency of the watched class, but
  on the oximeter *pulse-rate 1-Hz proxy* (not beat HRV) — out of the four-node scope; worth a separate look.

---

## Verified clean this pass (do NOT re-spend effort)
- **Units (class #1):** ~100 boundaries traced across DSP/profile/fusion/quantity/adapter/registry — **no**
  10³–10⁶× slip. Baevsky SI/CSI guard intact; `MGDL_PER_MMOL=18.018` used correctly both directions; profile is
  metric-canonical with imperial display-only (no persisted imperial); registry units match DSP outputs.
- **Clock Contract (class #2):** well-enforced fleet-wide. Only residue: one **dead** viewer-TZ line
  (`glucodex-app.js:672`, `setHours` on a `tMs`, identifier unused downstream); the synthetic-gen local getters
  (`glucodex-dsp.js:859`) are already grandfathered (`tests/dex-tests.js:3624`); an OverDex export **filename**
  falls back to `new Date()` "today" when there is no fusion window (`overdex-app.js:315`) — cosmetic.
- **Differential HRV divisor (class #5):** SDNN `÷(N−1)` unified across PulseDex/ECGDex/HRVDex/PpgDex; rMSSD and
  pNN50 (`>50`) counts consistent; PpgDex's clean-SQI-masked subset + 0.30 ectopy threshold are **documented**
  intentional. (The *bounds* drift is Findings 3/5 — a different sub-class the divisor audits didn't cover.)
- **Spectral honesty (class #6):** no surfaced proxy — every HF/LF/VLF traces to Lomb–Scargle; the crude
  `spectral()`/`hf≈rmssd²` proxy is removed and gate-locked (`tests/dex-tests.js:8908`). Band edges in Hz,
  powers in ms².
- **Silent fallbacks (class #4):** Integrator/`oxydex-fusion` return `{ok:false,reason}`/`null` honestly; the
  `catch{}` hits are benign UI/storage guards.
- **Evidence honesty (class #7):** HRVDex's proprietary-fed composites (`ansLoad/efc/welfare/otr/crs`) are
  correctly demoted to `heuristic`; no black-box input graded `measured`/`validated`; no retired vocabulary as a
  tier. (Noted out-of-scope/deferred: a heuristic `stress_high` event currently fuses with equal weight in the
  Integrator noisy-OR — an explicitly deferred Integrator pass.)
- **DSP edge cases (class #10):** GlucoDex clip-floor (Lingo 55–200) detected + surfaced + events stamped
  `meta.clampFloor:true`; ECG robust R-peak seed + stall-recovery; sampEn `O(cap²)` with tolerance tracking.
- **Provenance (class #9):** GATE A 8/8, GATE B reproducible (see Finding 0).

---

## Comparison to the existing audit ledger
This pass **corroborates** that the prior deep audits' fixes hold: the PulseDex `spectral()` proxy is gone, the
ECGDex `Date.now()`/`Date.parse` event/loader fabrications are fixed, the HRVDex transparent-`0` rolling-baseline
bug is fixed, and the `÷(N−1)` unification is intact. Where it **adds** to the ledger:
- **Finding 1** realizes the 2026-07-01 privacy audit's two *untraced hypotheses* ("`glucodex_meals` free-text",
  "CSV field values → `innerHTML` beyond the filename") as a live sink — and shows Security Phase A (F1/F2/F3)
  remediated only OxyDex/PulseDex, leaving GlucoDex's same-class sink (and the shared escaper unloaded) in an
  **un-remediated node**. (Known-open privacy residue F4/F5/F6/F7 is **not** re-filed here.)
- **Findings 3 & 5** are a *different sub-class* of #5 than the prior "divisor" audits checked: the
  artifact-rejection **bounds** (2000 vs 2200 ms), not the SD divisor — uncovered because the prior passes
  verified `std()` consistency but not the plausibility windows.
- **Finding 2** is a new instance of #3 (zero-default composite) in OxyDex's Readiness — the prior #3 work
  covered HRVDex's subjective composites + transparent columns, not this SpO₂ subscore.
- **Finding 4** (ECGDex `apnea`/`hrvStability` never reaching fusion via the automated path) is new contract
  drift that no current gate covers.

## Prioritized punch-list (correctness first)
1. **Finding 1 (MED, security):** GlucoDex meal-label → `innerHTML` XSS (stored + nutrition-CSV-derived); load
   `dex-escape.js` + escape `m.label`. One gated GlucoDex re-bundle, export-inert.
2. **Finding 3 (MED, surfaced number):** ECGDex `validateRR` bound mismatch (2200 vs 2000) breaks the documented
   corrected-vs-corrected parity. Align the bounds. One gated ECGDex re-bundle.
3. **Finding 4 (MED, contract):** ECGDex `apnea`/`hrvStability` not in the shared/automated export → Integrator
   autonomic-slope + apnea authority silently null. Extend the rich builder or warn + assert.
4. **Finding 2 (MED, latent):** OxyDex Readiness SpO₂ subscore fabricates best-25 on absent hypoxia; gate on
   inputs present.
5. **Finding 5 (LOW):** unify the RR-plausibility upper bound fleet-wide (with #3) + add a differential test.
6. **Finding 6 (LOW):** fix the `SignalSpec.cgm.unit` label to `mg/dL`.

*Each accepted item lands as its own dated gated brief per the `CLAUDE.md` lifecycle; honors the re-bundle +
GATE-A/fixture and `Dex-Test-Suite.html?full` + `verify-provenance.html` gates; touches no frozen name / the
`ganglior.node-export` schema / the Clock Contract. No fixes were applied in this pass — findings only.*
