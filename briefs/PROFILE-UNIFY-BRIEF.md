# Profile Unification — Build Brief

Handoff for implementing the unified user profile across the Dex suite. Companion to the two
review artifacts already in the repo:
- **`User Profile - Unified Proposal.html`** — the proposal (problem, architecture, taxonomy, calc matrix, per-node changes, gates).
- **`Unified Profile - Detailed Mockup.html`** — the interactive reference UI (3-tier cascade, cited norms, evidence badges, units toggle, collapse). Treat its behavior + look as the spec.

Pattern parallel: the unified **export bar** (`Export Bar - Unified Proposal.html`) and `metric-registry.js`.

---

## Goal
Replace **six** drifted per-node profiles (3 code shapes, 6 localStorage schemas, 6 DOM-id conventions,
copy-pasted formulas) with **one shared engine + one shared identity + one panel**. Each node only
declares which **field groups** it uses.

## Current state (audited)
| Node | Code shape | localStorage | ids |
|---|---|---|---|
| OxyDex | global `UP` object | `oxydex_profile` (JSON) | `profAge…` |
| HRVDex | bare globals + per-key | 10× `prof_age…` | `prof_age…` |
| PulseDex | overview-module globals | `pulsedex_profile` | mixed |
| ECGDex | IIFE `window.ECGProfile` | `ecgdex_profile` (JSON) | `ecgAge…` |
| PpgDex | IIFE `window.PPGProfile` | `ppgdex_profile` (JSON) | `ppgAge…` |
| GlucoDex | IIFE `window.GLUProfile` | `glucodex_profile` (JSON) | `gluAge…` |
| Integrator | none — reads node exports only | — | — |

CSS is already shared (`.prof-*`, `.pd-group*` in `ans-design.css`).

---

## 1 · `dex-profile.js` — the shared engine (`window.DexProfile`)
New plain global module (load order: after `metric-registry.js`, before each node's `*-app.js`).
Single home for storage + ALL formulas + the panel renderer. Exposes:
- `get()` / `save()` / `load()` — one identity record in localStorage key **`tepna_profile`** (shared across all nodes, versioned schema, superset of all fields).
- `migrate()` — idempotent shim that reads the 6 legacy keys on first load, writes `tepna_profile`, never fabricates (Clock-Contract spirit: missing field stays empty).
- `resolve(field)` — the **3-tier cascade**: manual ?? detected ?? population-norm. Returns `{v, origin}` where origin ∈ `you|detected|pop`.
- `derive(profile, signalCtx)` — returns all derived values + `groundTruthChecks[]` + validity flags.
- `renderPanel(manifest)` — builds the panel from a node's group manifest.
- `prefillFrom(detected)` — persists best detected values (resting-HR handoff).

### Field groups (manifest per node)
`identity` (age, sex, **units**) · `body` (weight, height, body-fat?, waist?) · `cardio` (resting-HR, HRmax, β-blocker, AF) · `hemodynamic` (SBP, DBP) · `fitness` (VO₂ GT, activity) · `environment` (elevation) · `therapy` (CPAP) · `metabolic` (diabetes, therapy, target, A1c).

Manifests: OxyDex `id,body,cardio,hemo,fitness,env,therapy` · HRVDex same +therapy(CPAP new) · Pulse/ECG/Ppg `id,body,cardio,fitness,env,therapy` (NO hemo — single-site signal has no pulse wave, brief §6) · GlucoDex `id,body,metabolic` · Integrator reads identity only.

### Units (per CLAUDE.md §📏)
Store + compute in **metric always**. Imperial is a display-layer switch (kg↔lb, cm↔in, m↔ft), **metric default**. Convert at the input/render boundary only. The Identity group hosts the Metric/Imperial toggle.

---

## 2 · Cited NORMS table (one for the whole suite)
Replaces HRVDex's NHANES bands, OxyDex's linear formula, ECG/PPG's sex-only constants. Each row carries a `source`. Interpolate by age. Build the panel norms exactly as the mockup's `renderNorms()`.

| Field | Source | Note |
|---|---|---|
| Weight · Height | CDC NHANES 2017–20 | age×sex, interpolated; **clamps at the 70 band above 70** (NHANES ceiling) |
| HRmax | Tanaka, Monahan & Seals 2001 | `208 − 0.7×age` |
| Resting HR | NHANES resting-pulse (Ostchega 2011) | **single flat ~70 bpm**, no age/sex model — weakest prior, prefer detected/manual |
| VO₂max | ACSM 11th ed. / FRIEND (Kaminsky 2015) | 50th-pct by age×sex |
| Blood pressure | 2017 ACC/AHA (Whelton et al.) | **flat 120/80**, age/sex-INDEPENDENT, NOT a population mean; type-only override |

Detected tier: resting HR = **nocturnal floor (sleeping HR) + 8** → awake; VO₂ from HRmax/HRrest.

---

## 3 · Formula divergences — make OxyDex canonical (fixture-neutral rewire)
Only OxyDex exports body-derived values (`vo2est`, `karv`, `vo2est.vo2Category` in its per-night `advanced` block). Standardize the engine on OxyDex's choices so its exports don't move:
- **BSA**: use **DuBois** `0.007184·W^0.425·H^0.725` (OxyDex). HRV/ECG/Ppg currently use Mosteller `√(h·w/3600)` → panel-display shift only, not exported → no fixtures.
- **VO₂ category**: one ACSM table (OxyDex's). Watch OxyDex exported `vo2Category` label near band edges.
- **VO₂ HRV-adjust**: KEEP **per-signal** — OxyDex's 1 Hz-proxy rMSSD and ECG/Ppg's true-ms rMSSD are different scales; unifying the shape would silently move ECG/Ppg VO₂. Unify only base (`15.3·HRmax/HRrest`) + altitude (already identical).
- **BAP**: pick one (Baevsky regression vs `(age/HRmax)(SBP/80)`) or drop — panel-only, non-standard, flagged.
- Resting-HR default change is display-only (real exports use measured HR).

Derived grid surfaces **validated/measured only**: BMI(v), BSA(v), VO₂ category(v), WHtR(v, when waist), RMR(v, Mifflin/Katch-McArdle), VO₂ percentile(v), HRmax(v; experimental when β-blocker), MAP(m), PP(m). **IBW & TDEE dropped** from the summary (heuristic) — activity/body-fat remain as inputs (body-fat → Katch-McArdle RMR).

### New citation-supported formulas (additive)
Katch-McArdle RMR `370 + 21.6·LBM` (body-fat) · TDEE `RMR×PAL` (FAO/WHO 2001, heuristic — input only) · WHtR `waist÷height` ≥0.5 risk (Ashwell 2005) · STOP-BANG OSA prior (Chung 2008, BMI) · β-blocker gate (suppress Tanaka/Karvonen/VO₂) · AF gate (invalidate rMSSD/SDNN, Task Force 1996) · diabetes→CAN context flag in Integrator (Spallone 2011).

---

## 4 · Exports & ingestion (checked in code)
- **No export schema change needed.** Demographics aren't exported except GlucoDex's `personalization.profile` block (additive there). The **Integrator ingests zero demographics** (`integrator-dsp.js` reads only `recording.*`, `ganglior_events`, `apnea.*`, glycemic CV, `timeseries.epochs[].position`, CPAP `metrics`).
- Cross-signal flags (BMI→OSA, diabetes→CAN) need a NEW additive **`identity` envelope block** + a new Integrator adapter read. Never touch the FROZEN `ganglior.*` / `fascia` contract.

---

## 5 · Rollout sequence (todos 15–24)
1. Write `dex-profile.js` (engine + NORMS + resolve + derive + migrate).
2. OxyDex = canonical for shared choices.
3. Land on the 3 IIFE nodes first (ECG/PPG/Gluco): replace their `getProfile`/formulas with thin wrappers → `DexProfile`. Lowest risk.
4. Migrate OxyDex/HRVDex/PulseDex (delete `UP` / bare-globals / per-key stores).
5. Wire correctness gates + new formulas + resting-HR handoff.
6. **Re-bundle all 8** apps; hand-update every `manifestHash` in `BUILD-MANIFEST.json` (GATE A has teeth only if you do).
7. Regenerate fixtures ONLY where exported values move (check OxyDex `vo2Category`); re-run app + re-export, record producing `manifestHash` in `FIXTURE-PROVENANCE.json`.
8. Gates: `Dex-Test-Suite.html` all green + `verify-provenance.html` no red.
9. Add engine formula contracts to `tests/dex-tests.js` (shared by Node CI + browser suite) so it can't re-drift.

## Settled decisions
- Shared identity is ONE record; works for single-Dex users (no value assumes which Dex entered it); untouched fields stay on cited population default.
- Autonomic/ANS age **removed** (heuristic age-regression, no citation; suite already retired its card 2026-06-21).
- BP = flat 120/80, type-only (signal-projected BP is peer-controversial; no tier-3 data source).
- Resting HR = flat ~70 (weakest prior); sleeping vs awake distinction handled by +8 offset on detected.
- Evidence badges = canonical `dex-badges.css` discs (shape=trust), full 5-tier legend, one per view.
- Metric superiority is now in `CLAUDE.md` (§📏).
