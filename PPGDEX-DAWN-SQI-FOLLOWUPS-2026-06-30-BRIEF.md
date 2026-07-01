<!--
  PPGDEX-DAWN-SQI-FOLLOWUPS-2026-06-30-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-06-30 (node-residue closeout — the LOW-remainder sweep that closes the wave: §1 sqi-drop FIX + §4 sampEn cap landed; §2/§3 decided-defer; sibling briefs + HANDOFF all DONE) · **Created:** 2026-06-30 · **Owner brand:** Tepna
**Follows / executes-residue-of:** DEX-EVENT-UNIFY-FOLLOWUPS-II-2026-06-23-BRIEF.md (DONE 2026-06-30) +
the paired LOW-remainder sweep of PPGDEX-FOLLOWUPS §3/§4, GLUCODEX-FOLLOWUPS §6, ECGDEX-FOLLOWUPS-II §3,
SIGNAL-ADAPTER-FOLLOWUPS-IV §5 / -V, ECG-PPG-FOLLOWUPS-HANDOFF (co-load generation).

# PpgDex sqi-drop fix + LOW-remainder sweep — residue

> Read **CLAUDE.md** first (the two gates, the Clock Contract, frozen `Ganglior`/`fascia`, edit-`*.js`/
> `.src.html`-then-re-bundle). This file is the residue the 2026-06-30 sweep exposed. Everything the
> sweep EXECUTED is gate-green (Dex-Test-Suite all-green **1530/97**, verify-provenance GATE A **8/8** +
> GATE B reproducible, 0 drift; OxyDex re-bundled `68614f5ed267→990cb3ee4737`, PpgDex re-bundled
> `625a19d43e7e→13801a1ced0a`, both buildHashes UNCHANGED — external-JS-only). Nothing here blocks
> anything shipped; all are LOW polish / deferred-by-rationale.

## 0 · What the sweep shipped (context)

- **OxyDex DEX-EVENT-UNIFY-FOLLOWUPS-II §1/§2/§3 — DONE.** blArr perf-memoize (one p90-ceiling walk
  threaded through all 11 desat consumers, BIT-IDENTICAL — equiv gate byte-identical), vestigial
  `desat.nadir.count` guards dropped (post-dip + breathing-irregularity), TWO-close-mode decision
  documented. §4 (fixture refresh) declined (byte-identical → no value).
- **PpgDex §3 (sqi) + §4 (sampEn cap) — DONE.** See §1 below for the §3 FINDING. §4: `sampEn` gained the
  `MAXN=20000` deterministic-decimation cap mirroring `pulsedex-dsp.js` (inert for today's bounded
  callers; tol from the ORIGINAL SD pre-decimation).
- **GlucoDex §6 (dawn_surge) — DONE** as a self-contained byte-coverage group (deterministic hand-built
  CGM frame, since `genSynthetic` is non-deterministic — see §2).

---

## 1 · ✅ FINDING + FIX (executed 2026-06-30) — PpgDex node-export DROPPED the per-event `sqi` axis

**What surfaced while wiring the §3 sqi byte-coverage.** `ppgBuildNodeExport` mapped events with an
EXPLICIT field-list `{t,tMs,impulse,node,conf,meta}` that **omitted `sqi`** — even though `buildEvents`
stamps `sqi` on every event (a number for per-beat-quality impulses e.g. `motion_artifact_segment` via
`sqiAt()`, `null` where it doesn't apply) and `ecgBuildNodeExport` copies ALL keys (so the **ECGDex**
export carries `sqi`). So the PpgDex node-export silently diverged from ECGDex and from R7 ("SQI rides
ALONGSIDE conf, a SEPARATE axis"). The 6.5-min equiv fixture emits 0 events, so this was invisible.

**Fix (folded into the §3/§4 PpgDex re-bundle):** carry `sqi:(e.sqi!==undefined?e.sqi:null)` through the
`ppgBuildNodeExport` map. EXPORT-INERT for the 0-event equiv fixture (empty array). New self-contained
Dex-Test-Suite group *"PpgDex event byte-shape — sqi axis round-trip"* locks it (every exported event
carries `sqi`; `motion_artifact_segment` a non-null number; surge/`hrv_drop` null; + a source-mirror of
the emit + preserve contract).

**Residue for a future coder (LOW):**
- The **app's** downloaded JSON (`ppgdex-app.js exportGanglior`) also delegates to `ppgBuildNodeExport`,
  so a real multi-epoch PPG export now ALSO carries `sqi` on its events (additive, ECGDex-consistent).
  No consumer reads it yet — **the Integrator's `adaptPpgDex` could now weight on PPG `event.sqi`** the
  way it could for ECGDex; not wired. Decide if fusion should consume it.
- Confirm against a REAL multi-epoch Polar Verity Sense `*_PPG.txt` (+ ACC companion) that a live
  `motion_artifact_segment` round-trips a non-null `sqi` end-to-end (the gate proves the builder; a live
  drop-through is the standing UI-verification debt, -IV §1 / GLUCODEX §4).

## 2 · Committed `env.equiv.*_events` byte-fixtures — DEFERRED-by-rationale (GlucoDex §6 / PpgDex §3)

The sibling briefs suggested committed `env.equiv.glucodex_events` / `ppgdex_events` fixtures (the
HRVDex/PulseDex `_events` pattern). The sweep instead landed **self-contained byte-coverage groups**
(generate the input in-test, assert byte-shape + reproducibility), because the committed-fixture form is
impractical here:
- **PpgDex:** the only deterministic input the suite has (`SYNTH.renderPPG`) is a **~7 MB** 176 Hz optical
  waveform — absurd to commit as a fixture INPUT, and slow to re-`compute()` per run. The §3 group instead
  drives the shared builder on a hand-built event set (covers the sqi round-trip directly) + source-mirror.
- **GlucoDex:** `genSynthetic` is **non-deterministic** (Math.random), so it can't back a byte-diff fixture;
  the §6 group builds a deterministic CGM frame in-test (planted ≥20 mg/dL dawn rise → 2 `dawn_surge`).
- **ECGDex §3:** already DECIDED (in -II) to **keep the live 12e gate** (genSynthetic→compute byte-
  reproducible + sqi-axis shape); a committed fixture is the optional upgrade "only if 12e proves
  insufficient" — it has not.

**Do (optional, LOW):** if a committed reference is later wanted, the cleanest is a **fixture-only CASE**
(like `cpapdex_golden`): commit the deterministic export and have the gate rebuild it in-code (ECGDex via
`genSynthetic({durSec:3*3600,scenario:'osa'})` is deterministic and input-less; GlucoDex via the hand-built
frame in the §6 group). Not the input-driven `compute({text})` CASE shape (the inputs are too large / non-
deterministic). No re-bundle (test-layer only).

## 3 · Co-load GENERATION — DECIDED keep gated-static (SIGNAL-ADAPTER-FOLLOWUPS-IV §5 / ECGDEX-FOLLOWUPS-II §4)

`dex-coload.js` is the single ordered manifest and the `Co-load manifest` gate already asserts (a) it
stays in lock-step with what `SignalAdapters` registers AND (b) **every host realm** (Data Unifier ·
OverDex · Dex-Test-Suite · run-tests.mjs) co-loads every module — so the silent-drop failure mode the
generation step was meant to prevent is **already closed**. Having the hosts dynamically GENERATE their
`<script>` tags from the manifest adds load-ORDERING fragility in the unbundled hosts (and is not
verifiable in the cross-origin preview sandbox) for marginal maintainability gain. **Decision: keep the
gated-static tags.** Revisit only if a real second adapter-per-node or a host-count change makes the
hand-sync burden exceed the gate's protection.

## 4 · Minor

- **detectODI source-mirror regex** (P8 "Threshold-edge inclusivity" group) was relaxed to tolerate the
  threaded `opts.blArr` after `exitPct:drop` (the behavioral contract — routes through `detectDesatEvents`
  with `dropPct:drop/exitPct:drop` — is unchanged). Deliberate test-layer update; Node CI uses the same
  `tests/dex-tests.js`.
- **Standing Node-CI debt** (carry-forward): `node tests/run-tests.mjs` not run (no Node host); the new
  groups + the relaxed regex run identically in both runners by construction. Same debt as the sibling
  briefs' final section.

---

## Acceptance (any PR off this brief)
- [ ] Edited `*-dsp.js` / docs — never a bundled `*.html` by hand; re-bundled affected node(s).
- [ ] `Dex-Test-Suite.html` all-green; `verify-provenance.html` GATE A/B clean; `BUILD-MANIFEST.json` +
      `FIXTURE-PROVENANCE.json` updated on re-bundle; fixtures regenerated only where math moves.
- [ ] No new unbadged metric; Clock Contract untouched; no cross-node runtime dependency added; the
      canonical `ganglior_events` schema (+ the optional `sqi` axis, now fleet-consistent) preserved.
