<!--
  APNEA-TYPING-FUSION-2026-07-18-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-07-18 (**Phase 1** shipped in PR #171 — MotionDex's coverage-honest per-epoch effort series, rendered standalone in its own UI and predesigned at 10 s epochs for this fusion. **Phase 2** shipped here — the Integrator ingests `node:"MotionDex"`, builds `_motionEffortSeries`, and `typeApneaByEffort` types every desat over `[desat−15 s, +dur]`: effort present ⇒ obstructive, flat ⇒ central, no-coverage/ambiguous ⇒ **untyped, never guessed**. Additive `summary.apneaTyping` split; `confirmedAHI` untouched; null when MotionDex is absent. Gated by the `apnea-typing` group (6/6, both lanes) pinning all three typing invariants + the graceful no-op. Following the P7 `apneaCoupling` precedent it ships as an export field + gate with no render surface — a UI surface + bus-emitting the `apnea_obstructive`/`apnea_central` impulses (with EVENT-LEXICON registration) are the natural follow-ups.) · **Created:** 2026-07-18 · **Executes:** `MULTI-SENSOR-DERIVATIONS-2026-07-16-BRIEF.md` §1.1 · **Depends on:** `MOTIONDEX-BUILD-2026-07-17-BRIEF.md` (DONE) · **Consumer:** `INTEGRATOR-BUILD-BRIEF.md`

# Apnea typing — respiratory effort × desaturation → central vs obstructive

The first of `MULTI-SENSOR-DERIVATIONS`'s five now-unblocked Integrator fusions (MotionDex shipped). It
answers the one thing **oximetry alone cannot**: a desaturation with **effort present through it** is
**obstructive** (the airway is blocked but the body is still trying to breathe); with **effort absent** it
is **central** (no respiratory drive). MotionDex's chest-ACC thoraco-abdominal effort is that effort signal;
OxyDex's desats are the events to type. The typing lives in the **Integrator** (cross-node fusion), consuming
both node-exports — NOT in either single-signal node.

## 🔒 Invariant — nodes stay INDEPENDENT (the Integrator is OPTIONAL); build MotionDex FIRST
A user who never opens the Integrator must lose nothing. So the effort work is a **standalone MotionDex
feature first**, and the fusion is a second, optional layer on top:
- **Phase 1 (MotionDex) ships and is useful on its own** — MotionDex computes the effort series, **renders it
  in its OWN UI** (a respiratory-effort trend + present/absent read), and exports it. It is the consumer of
  its own field (so it does NOT violate "no metric without a consumer"), and gains **no** dependency on
  OxyDex or the Integrator. This lands first, independently.
- **Phase 2 (Integrator) degrades gracefully** — with no MotionDex export present it simply does not type
  (no error, no fabricated central), exactly as it tolerates any absent node. The apnea *typing* is the ONLY
  thing that lives in the Integrator; every input remains a self-contained single-signal node. The coupling
  is one-directional and lives entirely in the fusion layer. Phases 1 and 2 may ship as SEPARATE PRs.

## Method sources (literature-use policy — cite before any runtime constant)
- **[M20]** Manoni et al., 2020, *Sensors* — a wearable accelerometer "discriminates obstructive from central
  type thanks to its excellent sensitivity to thoraco-abdominal movements," fused with PPG apnea detection.
- **[R22]** Ryser et al., 2022, *Biomed. Signal Process. Control* — chest-worn accelerometer respiration /
  respiratory-cessation detection (the effort waveform's provenance; validates ~1.8 bpm vs RIP).
- **DOIs:** fill from `MULTI-SENSOR-DERIVATIONS` §References before any threshold reaches runtime as a cited
  constant. No networked data in a bundle (gate: `no-network`).

## Evidence tier — **experimental** (do NOT over-claim)
Three separate devices; the effort-vs-desat temporal alignment leans entirely on the Clock Contract; the
effort signal is an accelerometer surrogate (already `experimental` in `motiondex-registry.js`); not
diagnostic. The typed output is `experimental`-tier and must carry that badge everywhere it surfaces. It
does NOT replace CPAPDex's device-scored `central/obstructiveIndex` (from the CSL channel) — it is a
motion-derived estimate for the O2Ring-only / no-CPAP nights, tagged distinctly.

## Phase 1 — MotionDex: expose an effort-presence signal (additive export field)
`motiondex-dsp.js`'s `buildNodeExport` today emits `motion.respRateBrpm` (a scalar) — the fusion needs
effort **at a time**. Add an additive, coverage-honest per-epoch series:
- `respiratoryEffort` already band-limits the chest ACC (0.1–0.6 Hz) and has the RMS amplitude. Extend it to
  emit `effortSeries: [{ tMs, amp, present }]` where `present` is `amp ≥ effortFloor` (a documented, cited
  floor; `present:null` for an epoch where chest ACC is absent — never a fabricated "absent").
- **PREDESIGN the shape to fit Phase 2 (so the Integrator needs no further MotionDex change):** the cadence
  must be fine enough to resolve a single desat window — desats are ~10–30 s, so a 30 s epoch is too coarse.
  Use **~10 s epochs** (`tMs` = epoch start, floating). One contract serves both consumers: MotionDex's own
  effort-trend render AND the Integrator's "effort present in [desat−15 s, desat_end]?" window query. Also
  expose `effortCadenceSec` + `effortFloor` on the export so a consumer reads the cadence rather than assumes it.
- Surface it on the export as `motion.effortSeries` (additive → **minor**; `computeHash` moves → re-verify
  the equiv fixture; the golden gains the field, regenerate via `regen-goldens.mjs --node MotionDex`).
- **⚠️ absence vs no-data:** effort-absent (central) and chest-ACC-not-recording must be DISTINCT — the
  latter is `present:null`, excluded from typing, never scored as central. (This is the exact ×0.72
  coverage artifact `EVENT-COUPLING` §2 warns about, one modality over.)

## Phase 2 — Integrator: ingest MotionDex + type each desat
- **Ingest:** teach `integrator-dsp.js` `detectNode`/adapter to recognize `schema.node === 'MotionDex'`;
  build its effort series (mirror `_ecgPostureSeries`'s `{tMs, …}` shape) onto the night summary.
- **Type:** for each OxyDex `desat_event`, look up MotionDex effort over the desat window (reuse
  `reconstructEventTMs` + the P7 window/coverage machinery): `present` in-window ⇒ `apnea_obstructive`,
  clearly-absent ⇒ `apnea_central`, no coverage ⇒ untyped (dropped from the split, not guessed).
- **Emit (additive, guarded):** typed events (`apnea_obstructive` / `apnea_central`, `node:'Integrator'`,
  `conf` from MotionDex SQI × the desat conf) beside the existing desat stream, and a `summary.apneaTyping =
  { obstructive, central, untyped, coverageAssumed:false }` split — set ONLY on a usable window (the P7
  `underpowered`/`saturated` discipline). The headline `confirmedAHI` is UNCHANGED (this rides beside it).
- Re-bundle Integrator; re-verify `integrator_tch_golden` (should be byte-identical unless a fixture night
  carries MotionDex — add a committed synthetic MotionDex+OxyDex pair night if none does, so the typing
  path runs in CI).

## Gates
- Both nodes: `build.mjs --check`, GATE A/B, equiv legs (MotionDex effort-series + Integrator typing),
  `Dex-Test-Suite?full`, `no-network`, `verify-provenance`.
- A dex-tests group: a planted **effort-through-desat** night ⇒ obstructive; a planted **flat-effort desat**
  ⇒ central; a **chest-ACC-absent** desat ⇒ untyped (NOT central) — the coverage invariant, encoded.
- Evidence-badge coverage on every surfaced typed number (experimental tier).
- Changeset (minor — additive MotionDex field + new Integrator fusion). Roster/EVENT-LEXICON: register the
  `apnea_obstructive`/`apnea_central` impulses.

## Done-when
MotionDex exports a coverage-honest effort series; the Integrator types O2Ring desats obstructive/central
from it on a usable window (never guessing across a coverage gap), badged experimental, additive to the
existing AHI; both nodes re-bundled + fixtures re-verified; all gates (incl. the coverage-invariant group)
green. Spawn `-FOLLOWUPS` for anything surfaced (e.g. driving the typing into `confirmedAHIReportable`, or a
real quad-modal-night validation).
