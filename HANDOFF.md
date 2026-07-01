<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Tepna — Remediation Handoff (read this first to skip re-deriving)

_Last updated: 2026-06-12. Purpose: let a fresh thread get current in one read instead of
re-reconstructing the fusion algorithm and re-auditing. Authoritative detail lives in
`INTEGRATOR-FUSION-AUDIT.md` (analysis) and `INTEGRATOR-FUSION-ISSUES.md` (paste-ready tickets).
Build/clock rules live in `CLAUDE.md` — that file wins on any conflict._

---

## TL;DR state

**13 of 13 remediation items are shipped, bundled, and verified.** The fusion layer has no known
correctness defects, and every export is now self-attributing (R1). Nothing is outstanding.

| Item | What it was | Status |
|---|---|---|
| R1 | No build/input stamping on exports | ✅ shipped (provenance + CI harness) |
| R2 | PpgDex's 81 events silently excluded from fusion (node-name gap) | ✅ shipped |
| R3 | `window.overlapMin` double-counted (mislabeled intersection) | ✅ shipped |
| R4 | Two divergent apnea matchers (Integrator vs OxyDex) | ✅ shipped |
| R5 | Apnea match had no directionality / null-model gate | ✅ shipped |
| R6 | Noisy-OR + 0.97 cap undocumented in schema | ✅ shipped (`schema.method` v1.1) |
| R7 | Surge `conf` encoded signal quality (SQI), not severity | ✅ shipped |
| R8 | Cross-node metric-name collision (`sdnn` meaning two windows) | ✅ shipped |
| R9 | Single-signal sleep stages contradict each other | ✅ closed via T2 |
| R10 | Upstream RR/PPI first-beat artifact pollutes min/max | ✅ closed via T3 |
| R11 | False morphology precision + QRS ceiling | ✅ closed via T1/T6 + delineate anchor |
| T1–T6 | Round-2 brief (QRS ceiling, staging, first-beat, stale field, PulseDex clock, precision) | ✅ all shipped |

---

## Key invariants — do NOT silently break these

- **Apnea match gate is duplicated in two files and MUST stay identical:** `LEAD=15 / TRAIL=60`
  (seconds) in `oxydex-fusion.js`, and `leadMaxSec:15 / trailMaxSec:60` on `runFusion` in
  `integrator-dsp.js`. A surge may **lead** the SpO₂ nadir by ≤15 s, **trail** by ≤60 s. Symmetric
  windows or surge-before-desat confirmations are the bug R4/R5 fixed.
- **Null model:** Poisson `belowChance` + `pSpurious` stamped on every apnea finding;
  `confirmedAHIReportable=false` and KPI shows "— / below chance" when chance isn't beaten. On the
  Jun-10 fixture the lone −96 s pair → **0 confirmed** (correct).
- **Delineate anchor (this session):** when the return-to-baseline QRS search saturates or disagrees
  with the validated energy-median `medW` by >30 ms, Q/J anchor to `medW` (≈40% pre-R / 60% post-R).
  Keeps `qrsDur` sane AND stops the J-point/QT from drifting late. `mb.medW` must be set before every
  `delineate()` call (done in `analyze` and `qtcTrend`).
- **Confidence ≠ quality (R7):** surge `conf` scales to surge magnitude (`surgeConf(ampBpm)`); `sqi`
  rides alongside as a separate axis. Don't re-conflate them.
- **Clock Contract (CLAUDE.md §):** floating wall-clock `tMs` via `Date.UTC(...)`, read back with
  `getUTC*`. Never `new Date()`/now() fallback; a missing stamp is `null`, never fabricated.
- **Build rule (CLAUDE.md):** edit `*.js` + `Foo.src.html`, **never** the bundled `Foo.html`;
  re-bundle via the inliner after every change. 100% local, system-font stacks only.
- **Provenance (R1):** `ganglior-provenance.js` is loaded FIRST in every app and stamps
  `schema.provenance = { buildHash, generated, inputs[] }` on every export. ⚠️ **`buildHash` is RETIRED
  as a provenance signal (SIGNAL-ADAPTER-AND-FRONTIER Phase 7, 2026-06-30 — see `CLAUDE.md` §🔏).** It was
  *intended* to be SHA-256[0:12] of the immutable `__bundler/template` (the `.src.html` skeleton), but in
  a bundled app the inliner strips that template at unpack, so the committed value is actually a runtime
  inline-`<script>`/`<style>` shell fallback hash — NOT the template and NOT the executed code. **No gate
  reads it**; it is stamped into exports only as inert legacy metadata. **`manifestHash` is the sole
  executed-code identity** — a UUID-independent projection of the `__bundler/manifest` (the inlined
  `*.js`/CSS), and it is what `verify-provenance.html` GATE A checks. The input fingerprints
  come from a passive `FileReader` hook; do NOT remove it or add a CDN
  (would break the local-only + hash-stability contract). `verify-provenance.html` is the CI harness
  (build manifest + fixture audit).

---

## Verification recipe (what "done" looks like on the Jun-10 corpus)

- **Integrator:** `matchWindow.directionalWindowSec===75`, no `toleranceSec`; apnea finding present
  but `belowChance:true`/not reportable; `staging_disagreement` finding present (ECG REM 3% vs OxyDex
  77.5% → 75-pt gap); union overlap < pairwise sum.
- **ECGDex:** `intervals.qrsDur≈62` (not 123, not saturated) with `qrsDurDelineated`/`qrsDurSaturated`/
  `sampleGridMs`/`precisionNote` present; `minRR≈1191` (474 ms first beat corrected by `buildNN`);
  `quality.meanSQICaveat` when meanSQI<0.6 (Jun-10 = 0.521).
- **PulseDex:** `t0Ms` non-null from filename (`t0Source:"filename"`), so it joins fusion.
- **Gotcha:** if a regenerated export shows OLD numbers, the user re-ran a **stale cached `.html` tab**
  loaded before the last re-bundle. Have them hard-reload the app, not just re-drop the file.

---

## Open / next candidates

**Nothing outstanding** — all 13 remediation items (R1–R11, T1–T6) are shipped, bundled, and verified.

Optional hardening already noted in tickets (not required): global nearest-pair assignment vs greedy desat-order
   matching (R5 "optional"); calibrate `conf` against labeled events if any become available (R7).

Nothing else is outstanding. If a new review thread proposes "findings," check them against the
table above before acting — most will already be closed.
