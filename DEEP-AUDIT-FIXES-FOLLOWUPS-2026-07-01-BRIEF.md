<!--
  DEEP-AUDIT-FIXES-FOLLOWUPS-2026-07-01-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-07-01 (§1+§2 executed, §3 decided no-go; both gates green) · **Created:** 2026-07-01 · **Owner brand:** Tepna
**Follows:** [`DEEP-AUDIT-FIXES-2026-07-01-BRIEF.md`](DEEP-AUDIT-FIXES-2026-07-01-BRIEF.md) (residue discovered during its execution)

# Deep-audit fixes — follow-ups (residue from the 2026-07-01 pass)

Three items surfaced while executing the two 2026-07-01 findings. None is a currently-surfaced wrong
number (the executed pass closed those); each is a latent/scope-adjacent item. Correctness order.

## Execution log (2026-07-01)
- **§1 (ECGDex) — DONE + gate-green.** The primary ECG loader (streamed + inline) and the RR / Welltory-CSV
  exporters no longer fabricate a now()-anchor for a stampless recording — they thread `null` (Clock §2.6),
  activating the app's already-present honest paths (`_fmtEpochClock` relative "Nm" axis, node-export
  `startEpochMs:null`, `exportName`→'undated', `validateHR` self-relativize, rec-key synthetic id); the undated
  exporters anchor at 0 (deterministic relative-from-0, never now()). The `_floatNow` helper is retired as dead.
  Real (stamped) recordings stay byte-identical. External-JS → **ECGDex re-bundled `ede9e04831c8 → ac57ef19b66d`**,
  buildHash `146ac9c8b1bd` UNCHANGED. **EXPORT-INERT** (ecgdex-app.js only; `ECGDex.compute` lives in ecgdex-dsp.js)
  → the `ecgdex` fixture re-recorded `manifestHash` only.
- **§2 (HRVDex) — DONE + gate-green.** The pNN50 rolling slope (`pnn507`/`win_pnn`/`win_dates`) filters
  `Number.isFinite` instead of `!isNaN` — dropping an absent `null` while KEEPING a real `0` (pNN50=0 is
  physiological). `!isNaN(null)` was `true`, so a blank pNN50 was coerced to `0` and polluted the slope.
  External-JS → **HRVDex re-bundled `00578ca08503 → 936c007aed32`**, buildHash `de20db283366` UNCHANGED.
  **EXPORT-INERT** (`computeDerived` is app-render-only; `HRVDex.compute`/`hrvBuildNodeExport` never call it) →
  both HRVDex fixtures re-recorded `manifestHash` only.
- **§3 — DECIDED no-go (no code).** The current split — the six SUBJECTIVE columns 0-seed + the `_hasSubj`
  presence gate, the TRANSPARENT columns `null` — is correct and fully gated (every subjective-fed composite
  already returns `NaN` on a raw recording; no fabricated 0 reaches a user). Migrating the subjective columns
  to `null` + a presence gate touches `_hasSubj`, `compute()`/`_envToSeed` seeding, and every subjective
  composite — real blast radius for ZERO surfaced-correctness gain (cosmetic uniformity). Kept as-is; recorded intentional.
- **Gates.** `verify-provenance` core (recomputed from disk via `manifest-gate.js`): **GATE A 8/8 match**,
  **GATE B 15/15 reproducible, 0 drift, 0 absent** (only HRVDex + ECGDex moved). Source files syntax-clean; the
  new source-mirror assertions pass; both changes export-inert BY CONSTRUCTION (the equiv legs exercise unchanged
  compute/export code paths).
- **Residue → [`DEEP-AUDIT-FIXES-FOLLOWUPS-II-2026-07-01-BRIEF.md`](DEEP-AUDIT-FIXES-FOLLOWUPS-II-2026-07-01-BRIEF.md):** the §1/§2/§3 items themselves executed cleanly, but making transparent fields nullable surfaced two SAME-CLASS consequences not swept in this pass — (a) the HRVDex render layer (correlation scatter `~:819` + weekday distribution `~:849`) still reads a raw transparent field behind `isFinite`, which passes a `null` as a `0`, so a blank cell is plotted/aggregated as 0 (fabricated absence in a surfaced viz); (b) the ECGDex stampless-primary-ECG ACC-companion paths (`stampEpochPositions`/`accAnalyze`/`accExtras` with `null` t0Ms) + the undated-export (1970-anchor) representation were reasoned null-safe but not exercised. Captured in the -II brief.

---

## §1 · (LOW–MED, HYPOTHESIS) ✅ DONE — ECGDex primary ECG loader + RR/HRV exporters still fall back to `_floatNow()` for a missing `t0Ms`

**Observation.** Finding 2 removed the `Date.parse`/`_floatNow()` **cross-check** loaders, but
`ecgdex-app.js` still calls `_floatNow()` (= `Date.now()` shifted to floating wall-clock) as a fallback
in four non-cross-check spots: the streamed primary-ECG done handler (`~:126`), the inline primary-ECG
parse (`~:148`), and the two exporters `exportRR`/`_baevskyGeom`-HRV (`~:1092`, `~:1119`) — each
`(rec.t0Ms != null ? rec.t0Ms : _floatNow())`. `parseTSfloat()` (`~:90`, regex, Clock-faithful) is
still the primary loader's timestamp parser and is correct; the open question is only the **`now()`
fallback for a stampless recording**.

**Why it's a question, not yet a finding.** Clock Contract §2.6 is "a missing stamp → `null`, **never**
`now()`." The DSP `analyze`/`compute` path was already fixed to thread `null` (2026-06-30 clean-ledger
class #2/#3). The APP fabricates a `now()` anchor so a stampless file still *renders* a time axis — a
display convenience, but it makes the rendered clock (and any `exportRR`/HRV-export `t0`) viewer-wall-
clock- and run-time-dependent, and the exports are real `ganglior`/interop artifacts (not display-only
like the cross-check). **Decide:** (a) thread `null` and render/export a relative "t+Δ" axis when the
recording carried no stamp (contract-pure), or (b) record an explicit APP-render carve-out in
`CLAUDE.md`/`EVENT-LEXICON.md` if a display anchor is intentional. Reproduce first (a stampless
`*_ECG.txt` → does `exportRR` stamp a `now()`-derived `t0`?), then pick.

**Gate cost if fixed.** `ecgdex-app.js` edit → one ECGDex re-bundle (`manifestHash` bump). Likely
EXPORT-INERT for the committed equiv fixture (stamped input), but the RR/HRV **export** filenames/`t0`
would change for a stampless input — verify against the equiv leg; add a stampless-export assertion.

---

## §2 · (LOW, latent) ✅ DONE — HRVDex pNN50 rolling slope still coerces a blank pNN50 to `0`

**Observation.** After Finding 1, a blank `pNN50` parses to `null` — but the pNN50 7-day rolling slope
still filters `pnn507`/`win_pnn`/`win_dates` with `!isNaN(v)` (`hrvdex-dsp.js` ~:579/:607–608), and
`!isNaN(null) === true`, so a `null` flows in and is coerced to `0` in `linRegSlope`. This is a latent
fabricated-absence for `d_pnn50_slope`, **unchanged by the 2026-07-01 pass** (the old parse-to-`0`
behaved identically). It was left alone because (a) it is not the reported SDNN defect, and (b) the
correct filter for pNN50 differs from SDNN: **pNN50 = 0 is physiological** (0 % of successive NN differ
by >50 ms), so it must be KEPT, unlike SDNN where `>0` is safe. The presence-correct fix is
`Number.isFinite(v)` (keeps a real `0`, drops `null`) — NOT `> 0`.

**Gate cost if fixed.** `hrvdex-dsp.js` edit → one HRVDex re-bundle. EXPORT-INERT (the committed CSV has
complete cells; `d_pnn50_slope` is a rolling display metric, not in `buildNodeExport`). Add a
functional assertion: a window with a blank pNN50 excludes that day from the slope while a real `0` day
is kept.

---

## §3 · (deferred decision) 🚫 DECIDED no-go — Migrate the six SUBJECTIVE Welltory columns to `null` + presence-gate

**Observation.** Finding 1 deliberately kept `_stress/_energy/_focus/_sns/_psns/_coherence` (and the
proprietary `_hrv` HRV Score) at `||0` because the `_hasSubj` presence gate + the WELLTORY-COMPOSITES
quarantine depend on the six moving as an all-or-none 0-seed group (a raw/ECGDex-ingest recording seeds
them all `0`, and every subjective-fed composite already gates on `_hasSubj` `>0`). Migrating them to
`null` + a `!= null` presence gate would be more uniform with the transparent columns, but it touches
`_hasSubj`, `_seedFromRow`/`compute()` seeding, and every subjective composite — a coordinated change,
not a drop-in. **Decide** whether the uniformity is worth the blast radius; the current split (subjective
`0`-seed + `_hasSubj`, transparent `null`) is correct and gated as-is, so this is cleanup, not a defect.

**Gate cost if done.** `hrvdex-dsp.js` (+ possibly the adapter seed) → one HRVDex re-bundle; verify the
`_hasSubj`-gated composites still `NaN` on a raw recording (no fabricated `0`), equiv leg byte-identical.
