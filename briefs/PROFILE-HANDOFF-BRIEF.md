<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# PROFILE-HANDOFF-BRIEF — wire the detected tier into compute (+ cleanup)

**Status:** DONE — 2026-06-23 · **Created:** 2026-06 (undated)
<!-- Verified 2026-06-23: Task A (wire detected tier into COMPUTE) implemented via detOr0 in
     ecgdex/ppgdex/hrvdex/pulsedex -profile.js (adopts only origin==='detected'); OxyDex correctly kept
     display-only (decision-a, export-invariant) and GlucoDex is N/A (CGM node, no hrRest/vo2 override).
     Task B (prefillFrom staleness) DONE — now "newest recording wins" with the §2 note in dex-profile.js.
     Profile nodes re-bundled 2026-06-23. Task C (legacy dead-code DELETION) intentionally deferred to a
     separate low-priority pass (same residual as PROFILE-DOM-READ-AUDIT §4). -->

Handoff for the next AI coder. The **profile unification is DONE and gate-clean** — this brief
covers the remaining work: making the cross-node "detected" handoff actually drive computation,
a small staleness fix, and a deferred dead-code cleanup. Companion docs: `PROFILE-UNIFY-BRIEF.md`
(original spec), `Unified Profile - Detailed Mockup.html` (the panel spec).

---

## 0 · Current state (all shipped + gate-clean — DO NOT redo)

- **`dex-profile.js`** = `window.DexProfile`, the shared engine. One identity record in localStorage
  key **`tepna_profile`**. API:
  - `get()` → flat resolved profile (metric) — what node compute consumes.
  - `getRecord()` / `load()` → raw record `{ schema, units, age, sex, manual:{}, detected:{}, _pristine? }`.
  - `resolve(field)` → `{ v, origin }`, origin ∈ `you | detected | pop` (the **3-tier cascade**:
    manual ?? detected ?? population-norm).
  - `setManual(field, vMetric)` (null clears) · `derive(profile)` → derived + `groundTruthChecks[]` +
    `flags{}` · `setDetected(map)` (runtime) · `prefillFrom(detected)` (persists to `record.detected`).
  - `isPristine()` — true while the record holds no real user identity (only blank defaults).
  - `renderPanel({node, mount, onChange})` — builds the full panel (form groups + manifest-aware
    derived grid + evidence legend + cascade explainer + cited NORMS table).
  - `MANIFESTS` (per-node group lists), `GROUP_DEFS`, `NORMS`, `_setStore(obj)` (test seam).
- **All 6 profile nodes** are on the unified panel + shared identity:
  ECGDex, PpgDex, GlucoDex, OxyDex, HRVDex, PulseDex. Each `<App>.src.html` mounts
  `<div id="dexProfilePanel">` and loads `dex-profile.js` (after `metric-registry.js`, before the
  node `*-app.js`). Node `getProfile`/`pxProfile`/OxyDex `upLoad` read from `DexProfile`.
- **Pristine guard** keeps each node's historical fresh default until the record holds real data —
  this is why **OxyDex stays export-invariant** (pristine → age 49 → hrMax 174 → fixture reproducible).
- **Leak already fixed**: OxyDex auto-detected BP/VO₂/restHR and HRVDex ANS-age no longer write to
  **manual** identity. They go to the **detected** tier (`prefillFrom`) or nowhere (projected BP).
- **Gates GREEN**: `Dex-Test-Suite.html` 806/54 (incl. a 38-assertion `dex-profile` contract group,
  shared with Node CI via `tests/run-tests.mjs`) · `verify-provenance.html` GATE A 8/8, GATE B no
  drift · `BUILD-MANIFEST.json` + `FIXTURE-PROVENANCE.json` current.

⚠️ **Edit `.js` + `.src.html`, never the bundled `.html`. Re-bundle with the inliner
(`super_inline_html` input→output), then update that app's `manifestHash` in `BUILD-MANIFEST.json`
(read it off the verify-provenance `manifestHash` column or hash the bundle's `__bundler/manifest`
with SHA-256[0:12]). See CLAUDE.md "Re-bundle checklist".**

---

## 1 · TASK A — wire the detected tier into COMPUTE (the headline)

**Problem.** The detected handoff is currently **display-only**: `prefillFrom`/`setDetected` light up
the cascade + the panel's "detected" chip, but each node's *computation* still reads only its own
manual overrides + its own recording. So ECG's detected resting-HR does **not** feed OxyDex's VO₂/zones.

**Goal.** Where a node's `0 = auto` override is unset, fall back to the shared **detected** value
*before* the node's own local auto-fallback. Preserve manual-wins: only adopt detected when the user
has not set the manual override.

**Pattern (per node, in `getProfile`/`pxProfile`/OxyDex `upLoad`):** for the override fields
`hrRest` / `vo2` (and optionally `hrMax`):
```js
// manual override wins; else shared DETECTED; else 0 → node computes its own auto
function detectedOr0(field){
  var man = DexProfile.getRecord().manual;
  if (man[field] != null && man[field] > 0) return man[field];     // user value
  var r = DexProfile.resolve(field);                                // manual ?? detected ?? pop
  return (r.origin === 'detected' && r.v > 0) ? r.v : 0;            // adopt detected, NOT pop
}
// e.g. hrRest override:  rhr: detectedOr0('hrRest')   (0 ⇒ node falls back to its own night data)
```
Key rule: **adopt only when `origin === 'detected'`** — never let the flat `pop` default (RHR 70,
VO₂ norm) silently become an "override", or you destroy each node's own auto-detection.

**Rollout order (lowest risk first):**
1. **ECGDex, PpgDex, GlucoDex, HRVDex, PulseDex** — none export body-derived values → safe. Re-bundle,
   bump `manifestHash`, run both gates after each (or batch, then gate once).
2. **OxyDex LAST + CAREFULLY** — it EXPORTS `vo2est`, `karv`, `vo2Category` (per-night `newMetrics`
   block) and has a code-gated fixture (`uploads/OxyDex_2026-06-13_1056_summary.json`). Adopting a
   detected `hrRest`/`vo2` into `UP` **can move those exports**. Before committing:
   - Confirm the export path: the per-night `vo2est.hrRest` comes from **night data** at analysis
     time (when `UP.hrRestOverride` was 0). If you now feed a *detected* hrRest into `UP` and it
     reaches `recomputeFromProfile`/`computeKarvonenZones`, the export changes.
   - **Decision needed:** either (a) keep OxyDex's compute on its own night-data fallback (so the
     detected handoff stays display-only *for OxyDex* — simplest, fixture stays reproducible), or
     (b) genuinely adopt detected into the export and **regenerate the fixture** (re-run OxyDex on
     its committed inputs `O2Ring S 2100_20260612230016.csv` + `ECGDex_2026-06-13_1024_summary.json`,
     re-export, then update both `BUILD-MANIFEST.json` AND the fixture's `manifestHash` in
     `FIXTURE-PROVENANCE.json`).
   - Recommended: **(a)** unless the product genuinely wants OxyDex VO₂ to follow a *different* node's
     resting-HR — that's a clinical choice, flag it to the human.
   - Verify after: in a clean in-memory store, `DexProfile._setStore(mem); UP.age=49…; upLoad();`
     still yields `UP.age===49` & `upHRmax()===174` (export-invariance), AND the OxyDex
     verify-provenance fixture row reads **"reproducible ✓ (code-gated)"**.

---

## 2 · TASK B — fix `prefillFrom` staleness (small, in `dex-profile.js`)

`prefillFrom(detected)` writes a field to `record.detected` **only if currently empty** (never
overwrites) → the persisted detected tier sticks to the *first-ever* recording forever, so the
cross-session "no recording loaded" panel can show a stale number. **Fix:** let a newer recording
overwrite (simplest), OR stamp each detected field with the recording's `t0Ms` and keep the newest.
Runtime `setDetected` (current session) is already correct — this only affects persisted memory.
After the change, re-run the `dex-profile` contract group (no app re-bundle needed; it's an external
module — but the apps inline a copy, so to ship it to the apps you must re-bundle all 6 + bump
manifestHashes).

---

## 3 · TASK C — deferred dead-code cleanup (separate, low-priority pass)

The swap **neutered but did not delete** the legacy profile code (kept guarded for low-risk
reversibility). Tech debt — each node carries a live `DexProfile` path AND a dead legacy path. When
ready, delete per node: `renderProfileDerived(Px)`, `computeHints`/`computeProfileHints`,
`inferFromData`, `profileAutoDetectUpdate`, `applyAgeNorms`, `clearEstimate`, `onProfileInput`/
`profileChanged`, the `UP` object's now-dead branches, `PROFILE_KEYS`/`PX_PROFILE_KEYS`,
`upToDOM`/`upFromDOM`. Keep node-specifics that the panel does NOT cover: **OxyDex Karvonen zones**
(`#profileZones` + the zone math in `profileDerivedUpdate`) and **GlucoDex `gluCalib`** calibration
row + its `calibRow`/`calibState` logic. Re-bundle + re-gate each.

Also in this pass: the derived-grid **evidence grades are hardcoded** in `dex-profile.js`
`_derivedHTML` (`'validated'`/`'measured'`) — source them from each node's `<Node>Registry` instead
(cohesion mandate). And **Integrator §4** identity envelope (cross-signal BMI→OSA / diabetes→CAN) is
still unbuilt — net-new fusion scope, see `PROFILE-UNIFY-BRIEF.md` §4 + `INTEGRATOR-BUILD-BRIEF.md`.

---

## 4 · Gotchas learned this rollout (read before editing nodes)

- **Removing panel inputs breaks unguarded `getElementById('profX').value` reads.** Several files
  recompute from the DOM (`pulsedex-app.js`, `pulsedex-render.js` did; OxyDex/HRV had similar). After
  any further field changes, grep `getElementById\('prof.*'\)\.value` and route through
  `getProfile`/`pxProfile`, not the DOM.
- **A node's `saveProfile`/`updateProfile` must not persist removed inputs** — guard each `setManual`
  on element existence (else `num('')→null` clears manual). Done already; keep the pattern.
- **`onChange` re-renders must be debounced** for text inputs (renderPanel already does 400 ms) — the
  per-keystroke full-panel rebuild also preserves focus/caret (don't regress that).
- **Manifest-aware derived grid**: `_derivedHTML` shows metrics only for groups the node has
  (`body`→BMI/BSA/RMR/WHtR, `cardio`→HRmax, `hemo`→MAP/PP, `fitness*`→VO₂). PulseDex/ECG/PPG have
  **no `hemo`** (single-site, no BP) — don't re-add it.
- **Async render-coverage**: the suite settles from ~795/52 to **806/54** a few seconds after load
  (the app-bundle iframes run last). Wait for 54 groups before trusting "all green".
- **`buildHash` is non-deterministic / informational** — only `manifestHash` is gated (GATE A). Don't
  chase buildHash drift.

---

## 5 · Definition of done

`Dex-Test-Suite.html` = **806/54 all green** (incl. `dex-profile` contract group + every render
coverage) · `verify-provenance.html` = **GATE A PASS 8/8**, **GATE B no red** (OxyDex fixture
"reproducible ✓") · all changed apps re-bundled with `manifestHash` updated in `BUILD-MANIFEST.json` ·
consoles clean on every bundle.
