<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-07-11 · **Created:** 2026-07-11 · **Executes:** [`../audits/DEEP-AUDIT-FINDINGS-2026-07-11.md`](../audits/DEEP-AUDIT-FINDINGS-2026-07-11.md) · **Residue:** [`DEEP-AUDIT-FIXES-FOLLOWUPS-2026-07-11-BRIEF.md`](DEEP-AUDIT-FIXES-FOLLOWUPS-2026-07-11-BRIEF.md)

# Deep-audit fixes — 2026-07-11

Executes the `DEEP-AUDIT-FINDINGS-2026-07-11` punch-list. **Five of six findings executed** this pass
(F1, F2, F3, F5, F6); the sixth (F4 — extend the ECGDex export) is **export-moving** and needs the raw
`uploads/` corpus to regenerate the ECGDex equiv fixture, so it is deferred to the follow-up. Every
executed change is **EXPORT-INERT** (display/robustness only, or a threshold that does not move the
committed fixture clips), so each affected bundle re-stamps `manifestHash` with no fixture-output
regeneration. Both gates green; two regression groups added to `tests/dex-tests.js` (both runners).

## What changed (one gated change per node)

| Finding | Sev | Node / file | Change | manifestHash |
|---|---|---|---|---|
| **F1** | MED (security) | GlucoDex — `glucodex-app.js` + `GlucoDex.src.html` | Load the shared `dex-escape.js`; route `m.label` through `escapeHTML()` at both innerHTML sinks (meal list `:1048`, postprandial card `:473`). Closes the stored (typed) + file-derived (nutrition-CSV group column) XSS. | `3437c8f9f479 → 489b1a340d43` |
| **F2** | MED (fabricated absence) | OxyDex — `oxydex-dsp.js` | `computeKarvonenZones`: gate the SpO₂ subscore on hypoxia inputs *present* — withhold the subscore (`null`) and the whole Readiness composite (`readiness=null`, tier "Readiness withheld") instead of seeding 0/0 into the best 25/25 bucket. Primary compute path always supplies `odi4`/`hypDose` → behaviour-preserving there. | `a2894568e7d7 → b039ed5a30db` |
| **F3** | MED (surfaced number) | ECGDex — `ecgdex-dsp.js` | `_malikCorrect` RR range bound `2200 → 2000` ms to match `buildNN`, so `validateRR`'s documented corrected-vs-corrected (apples-to-apples) comparison actually holds for `[2000,2200]` ms beats. Display-only cross-check → export-inert. | `32552465d29d → 3a18fc5541d1` |
| **F5** | LOW (differential drift) | PulseDex — `pulsedex-dsp.js` | `artifactClean` RR upper bound `2200 → 2000` ms, unifying with ECGDex `buildNN` / PpgDex `correctRR` (Malik/Kubios). | `c5048c39655f → 2c4d1a285ad0` |
| **F6** | LOW (label drift) | shared — `signal-spec.js` | `SignalSpec.cgm.unit` `mmol/L → mg/dL` (the unit every CGM frame actually carries). Inlined only into the two non-provenance orchestrators (Data Unifier `→ 3e25ce672c2e`, OverDex `→ 8247daa941b5`); consumers are display-only. | *(orchestrators — no BUILD-MANIFEST entry)* |
| **F4** | MED (contract) | ECGDex/Integrator | **DEFERRED** → follow-up brief §1 (export-moving; needs the raw corpus to regenerate the ECGDex equiv fixture). |

## Gate results
- **`node tools/build.mjs --check`** — clean (10 owned bundles ≡ build(source), 0 drift).
- **`verify-manifest.mjs`** — **GATE A 8/8 match**, **GATE B 3 reproducible / 0 drift** (13 code-gated
  fixtures skip: raw `uploads/` inputs gitignored in this checkout).
- **`run-tests.mjs`** — **all 1901 assertions pass · 11 skipped · 127 groups**, including two new
  regression groups: the GlucoDex meal-label escaping asserts in `Security — untrusted filename renders
  escaped` (F1), and `Differential HRV — RR-plausibility upper bound unified to 2000 ms` (F3/F5).
- **Release:** dropped `changes/2026-07-11-deep-audit-findings-fixes.md` (`bump: patch`, `type: security`);
  regenerated `tests/changes-list.json` + `tests/docs-ledger-list.json`. `release-ledger` check 7 (code
  moved ⇒ changeset present) satisfied. No hand-edit of version/CHANGELOG — `release.mjs` folds it.

## Gate-cost caveat (recorded)
The browser-only **equiv/GATE-C legs** (`env.equiv.*` re-running `compute({raw input}) ≡ committed
export`) cannot run headless in this checkout because the raw `uploads/` recordings are gitignored. F2/F3
are display/robustness-only (export byte-identical by construction). **F5 is export-inert by reasoning**
(`artifactClean` *replaces* out-of-range beats with the local median — N preserved — and a resting RR
clip carries no sub-30 bpm `[2000,2200]` ms beats), but this was **not** re-confirmed against the raw
PulseDex clip here; the PulseDex equiv leg must be verified on the next full-corpus run — see follow-up §2.

## Done when (all met, except the deferred F4)
- [x] F1/F2/F3/F5/F6 source edits + affected bundles re-bundled (owned `build.mjs`).
- [x] `BUILD-MANIFEST.json` re-stamped (GATE A 8/8); fixtures re-stamped manifestHash-only (export-inert).
- [x] Regression assertions added (both runners) and green.
- [x] Changeset dropped; ledgers regenerated; `docs-ledger` + `release-ledger` green.
- [ ] F4 executed — **deferred** to the follow-up (needs the raw corpus).
