<!--
  NODE-RESIDUE-FOLLOWUPS-2026-06-30-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
  Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
  project root, or http://www.apache.org/licenses/LICENSE-2.0
-->

**Status:** DONE — 2026-06-30 (§3 WIRED + gated; §1/§2 deferred-by-rationale, §4 environmental standing debt — impl paths recorded herein; follow-up NODE-RESIDUE-FOLLOWUPS-II-2026-06-30-BRIEF.md spawned — ECGDex floor-parity decision + sqiFloor tag-consumption audit) · **Created:** 2026-06-30 · **Owner brand:** Tepna
**Closes-out / executed-residue-of:** ECG-PPG-FOLLOWUPS-HANDOFF-2026-06-27-BRIEF.md (DONE 2026-06-30) +
PPGDEX-FOLLOWUPS-2026-06-27-BRIEF.md (DONE) + ECGDEX-FOLLOWUPS-II-2026-06-27-BRIEF.md (DONE) +
GLUCODEX-FOLLOWUPS-2026-06-27-BRIEF.md (DONE) + PPGDEX-DAWN-SQI-FOLLOWUPS-2026-06-30-BRIEF.md (DONE).

# In-flight node residue — closeout follow-ups (what still carries forward)

> Read **`CLAUDE.md`** first (the two gates, the Clock Contract, frozen `Ganglior`/`fascia`,
> edit-`*.js`/`.src.html`-then-re-bundle). This brief captures the residue that surfaced while CLOSING
> the coordinated PpgDex + ECGDex + GlucoDex follow-up wave on 2026-06-30. Everything the closeout
> EXECUTED is gate-green (**Dex-Test-Suite all-green 1594/103**, **verify-provenance GATE A/B +
> `__provenanceOK` green**, 0 drift, **NO re-bundle** — the closeout was test-layer + docs only). Nothing
> here blocks anything shipped; all items are LOW / deferred-by-rationale / environmental standing debt.

## 0 · What the closeout shipped (context — all DONE 2026-06-30, no re-bundle)

- **PPGDEX-FOLLOWUPS §2 — DONE.** New `tests/dex-tests.js` group *"Integrator ingests the LIGHT PpgDex
  export gracefully (PPGDEX-FOLLOWUPS §2)"* (10/10) — the PPG twin of the ECGDex 12d group. A light
  `recording+ganglior_events` PPG export drives `adaptEnvelopeNode('PpgDex')`: rmssd/sdnn null (consensus
  skipped, never a fabricated 0), empty posture yet `postureSource:'limb-acc'` still tagged,
  `autonomic_surge`/`motion_artifact_segment` events keep flowing, the per-event `sqi` axis round-trips;
  the REAL committed 0-event `PpgDex_2026-06-27_equiv` fixture also ingests cleanly.
- **GLUCODEX-FOLLOWUPS §3 — DONE.** New group *"Integrator ingests the GlucoDex export end-to-end
  (GLUCODEX-FOLLOWUPS §3)"* (11/11) — the REAL committed `GlucoDex_2026-06-27_equiv` fixture (42 events,
  `recording.clamp:{detected:false}`) drives `adaptEnvelopeNode('GlucoDex')`: all 42 events map with
  reconstructed `tMs`, `summary.clampSat` surfaces null (CHECKED, not absent), the absent cell series
  degrades to an empty `series.cells`; plus a hand-built clamp-DETECTED light export proving the §2
  down-weight (clip-floor `nocturnal_hypo` conf ×0.5 + `clampFloor`; a genuine hypo keeps 0.9).
- **PPGDEX-FOLLOWUPS §11 — RESOLVED (superseded + residue corrected).** The `buildHash` `_doc`/column-label
  trap was overtaken by the Phase-7 provenance rework: `verify-provenance.html` no longer reads/booted
  `buildHash` (pure-static, `manifestHash`-only GATE A) and `BUILD-MANIFEST.json`'s `_doc` was rewritten to
  frame `buildHash` as retired/inert. The residual stale "buildHash = immutable `__bundler/template` /
  fingerprints the executed code" claims in **`HANDOFF.md`** + **`INTEGRATOR-FUSION-ISSUES.md`** were
  corrected to point at the retirement (pointing to `CLAUDE.md` §🔏; `manifestHash` is the sole code identity).
- **GLUCODEX-FOLLOWUPS §7 — CONFIRMED DONE (was flagged, already landed).** `dex-coload.js` is the single
  ordered co-load manifest and the *"Co-load manifest — single source vs host realms"* gate (+ §1/§1b/§2/§3
  legs) asserts every host realm co-loads every module — the silent-drop hand-sync it warned about is closed.
- **Decisions recorded in-brief (no code):** ECGDEX-FOLLOWUPS-II §3 (keep the live 12e event gate) and §4
  (keep the gated-static co-load tags — reaffirming PPGDEX-DAWN-SQI §3).

---

## 1 · ECGDEX-FOLLOWUPS-II §5 — overnight `*_ECG.txt` orchestrate perf cap (DEFERRED, LOW)

**Decision this pass: DEFER, with a clean impl path recorded.** A Unifier/OverDex-dropped overnight ECG
runs the FULL `analyze()` synchronously on the main thread (the orchestrate path has no Worker), so a
multi-hour record can jank the tab. This was deferred out of the green-keeping closeout for two honest
reasons: (1) it is explicitly **conditional** — "*if* overnight ECG via the Unifier matters" — and today's
callers are bounded (the ~6-min equiv clip); (2) unlike PpgDex's pure-function `sampEn` `MAXN` cap (which is
inert because decimating an interval SERIES preserves its distribution), **you cannot decimate an ECG
WAVEFORM** without destroying QRS morphology, so any cap is a behaviour change, not an inert guard — it would
require a real `ecgdex-dsp.js` re-bundle + equiv-fixture re-record, which a "keep the fleet green" sweep
should not carry.

**Do (when overnight-ECG-via-Unifier becomes real):** add a sample-COUNT guard on the orchestrate
`compute()` path (NOT the app, which keeps its Worker) that REFUSES/flags above a large threshold
(≈2M samples ≈ >4 h at 130 Hz) rather than hanging — inert for the ~6-min fixtures (so the equiv fixture
stays export-inert, `manifestHash` re-recorded not regenerated). Re-bundle ECGDex + both gates per the
`CLAUDE.md` §🔏 re-bundle checklist. NB the seed fix's `_seedScale` already adds one O(N) subsample+sort.

## 2 · GLUCODEX-FOLLOWUPS §5 — GlucoDex `captureAppExport` render-coverage diff (DEFERRED, LOW)

**Decision this pass: DEFER (browser-render-rig-only + unverifiable here + by-construction-safe).** The
`-VIII §1` live `appExport ≡ compute()` diff (`captureAppExport`, in `Dex-Test-Suite.html`'s render-coverage
rig) covers OxyDex/PulseDex/HRVDex but not GlucoDex. GlucoDex parity is **by construction** — the app's
`exportGanglior` delegates to the same `glucoBuildNodeExport` the headless equiv gate already exercises — so
this is hardening, not a known gap. It was not added in the closeout because the render-coverage rig boots a
real bundle in a hidden iframe and is only assertable on a **same-origin** static host; adding an unverified
probe risks redding the browser rig.

**Do (when a same-origin static-host CI runs the render rig):** add a GlucoDex entry to the
`captureAppExport` rig (drive `#demo` → `win.exportGanglior()` / the GlucoDex export entry, diff against
`GlucoDex.compute({text})` with the shared `_eqDiff` EXCL set). Test-layer only, no re-bundle. Re-confirm the
`-XI` storage-hygiene classification (GlucoDex `#demo` ingest is transient — no `localStorage` snapshot needed).

## 3 · Forward — the Integrator could now weight on PpgDex `event.sqi` (DECIDED → WIRED 2026-06-30)

**EXECUTED 2026-06-30 (WIRED, per owner decision).** `integrator-dsp.js` gained `PPG_SQI_FLOOR = 0.3`
(Integrator-local, NOT kernel-sourced — the PB_CVHR_MIN precedent) + a CATEGORICAL sqi-floor in
`adaptEnvelopeNode`'s PpgDex branch mirroring the GlucoDex clamp-floor: a PpgDex event with `sqi < 0.3` gets
`conf ×0.5` + a `sqiFloor` tag at ingest (the unusable-quality tail), COMPLEMENTARY to — not double-counting —
the fleet-generic `effConf = conf×(sqi??1)` proportional taper. **Premise correction:** PpgDex ALREADY stamps
`sqiAt()` on `autonomic_surge`/`hrv_drop` (fleet-consistent with ECGDex — the note below's "not wired" was only
true of the Integrator-side *policy*; the per-event plumbing + the generic effConf taper were already live), so
**NO `ppgdex-dsp.js` change / NO PpgDex re-bundle** was needed. Integrator re-bundled `215fe4dc22d0→2ba8d6a61cb8`
(buildHash unchanged, external-JS-only; GATE A updated). `sqi` PRESERVED (R7). Gated: new Dex-Test-Suite group
*"Integrator PpgDex sqi-floor down-weight (§3)"* 6/6 (both runners) + source-mirror; policy in EVENT-LEXICON.md
§6.9. Both gates green (Dex-Test-Suite 1614/105 all-green incl. the Integrator render-coverage rig 9/9;
verify-provenance GATE A/B + `__provenanceOK`).

Surfaced by PPGDEX-DAWN-SQI-FOLLOWUPS §1: now that `ppgBuildNodeExport` carries the per-event `sqi` axis
(fleet-consistent with ECGDex), the Integrator's PpgDex ingest COULD down-weight a low-`sqi`
`motion_artifact_segment` / `autonomic_surge` the way it could for ECGDex — **not wired.** `adaptEnvelopeNode`
already preserves `sqi` on each mapped event (verified), so the plumbing is present; only the fusion-weighting
policy is a decision. **Do (if fusion should trust low-SQI PPG events less):** add an `sqi`-aware confidence
taper in the PpgDex branch (mirror the GlucoDex clamp-floor down-weight pattern), gate it in both runners,
and document the policy in `EVENT-LEXICON.md`. Decide first — it is a real fusion-semantics change, not a
mechanical one.

## 4 · Standing debt (fleet-wide, environmental — carried in every sibling brief)

- **Live-UI drop-zone verification** (PPGDEX §6 · ECGDEX-II §6 · GLUCODEX §4). A real vendor file dropped
  into the LIVE Data Unifier / OverDex drop-zone → routes → `emit<Signal>NodeExport` → renders a node
  summary was not exercised (the render-coverage rig is only assertable on a same-origin static host; the
  headless path is fully gate-proven, so this is confirmation, not discovery). Now unblocked for ecg/ppg/cgm
  since `HOST-EMIT-ALLOWLIST` widened `canEmit` — a drop actually emits an export to inspect.
- **Node-CI** (PPGDEX §7 · ECGDEX-II §6 · GLUCODEX §8 · DAWN-SQI §4). `node tests/run-tests.mjs` was not run
  (no Node host in this environment). The new §2/§3 groups + everything else run identically in both runners
  by construction (shared `tests/dex-tests.js`). Run when a Node host is available.

---

## Acceptance (any PR off this brief)
- [ ] Edited `*-dsp.js` / docs — never a bundled `*.html` by hand; re-bundled affected node(s) if code moved.
- [ ] `Dex-Test-Suite.html` all-green; `verify-provenance.html` GATE A/B clean; `BUILD-MANIFEST.json` +
      `FIXTURE-PROVENANCE.json` updated on any re-bundle; fixtures regenerated only where math moves.
- [ ] No new unbadged metric; Clock Contract untouched; no cross-node runtime dependency added; the
      canonical `ganglior_events` schema (+ the optional `sqi` axis, now fleet-consistent) preserved.

## Cross-references
- `ECG-PPG-FOLLOWUPS-HANDOFF-2026-06-27-BRIEF.md` · `PPGDEX-FOLLOWUPS-2026-06-27-BRIEF.md` ·
  `ECGDEX-FOLLOWUPS-II-2026-06-27-BRIEF.md` · `GLUCODEX-FOLLOWUPS-2026-06-27-BRIEF.md` ·
  `PPGDEX-DAWN-SQI-FOLLOWUPS-2026-06-30-BRIEF.md` — the five briefs this pass closed.
- `CLAUDE.md` §🧪 (test gate) · §🔏 (provenance gates + re-bundle checklist + `buildHash` retirement) · §🎫 · §🔒.
- `HOST-EMIT-ALLOWLIST-2026-06-27-BRIEF.md` — resolved the live-emit-allowlist residue that unblocks the live-drop debt.
