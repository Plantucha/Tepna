<!--
  ECG-PPG-FOLLOWUPS-HANDOFF-2026-06-27-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-06-30 (node-residue closeout — both children (PPGDEX-FOLLOWUPS + ECGDEX-FOLLOWUPS-II) now DONE + the live-emit-allowlist residue resolved by HOST-EMIT-ALLOWLIST — all §2-step-3 node-independent remainders closed/decided/carried; residue → NODE-RESIDUE-FOLLOWUPS-2026-06-30-BRIEF.md; prior progress: §1 (a) coupled export-enrichment + §2-step-2 (b) companion-bundle ingest BOTH DONE 2026-06-27 — both nodes, both gates green; only §2-step-3 node-independent remainders + the discovered live-emit-allowlist residue OPEN) · **Created:** 2026-06-27 · **Executes:** PPGDEX-FOLLOWUPS-2026-06-27-BRIEF.md + ECGDEX-FOLLOWUPS-II-2026-06-27-BRIEF.md · **Follows:** ECGDEX-FOLLOWUPS-2026-06-27-BRIEF.md (decided §1, deferred impl here)

# Handoff — execute the PpgDex + ECGDex follow-ups (ONE coordinated pass)

> **Next coder: read this first, then execute both child briefs.** This is the single entry point. It
> exists for ONE reason: the highest item in each child brief is **the same architectural decision**,
> and the prior pass deliberately deferred the implementation so the two land with **one shared export
> shape**. Land them together or you will create the exact node-divergence the prior pass avoided.

## ✅ EXECUTION LOG — 2026-06-27 (§1 THE COUPLING executed; both gates green)

**§1 coupled (a) export-enrichment — DONE (landed BOTH nodes together, one shared shape).** Designed ONE
rich-export shape and applied it to BOTH `ecgBuildNodeExport` (`ECGDEX-FOLLOWUPS-II §2`) and
`ppgBuildNodeExport` (`PPGDEX-FOLLOWUPS §1`), gated behind `opts.rich`: the orchestrate emitters
(`signal-orchestrate.emitEcgNodeExport` / `emitPpgNodeExport`) pass `rich:true`; the apps' `exportGanglior()`
do NOT → both LIGHT streams stay **BYTE-IDENTICAL**. Rich carries exactly the consensus slice the
Integrator's `adaptEnvelopeNode` reads — ECG: `hrv.time.{wholeRecordRMSSD/SDNN + display + sdnnIndex}` +
`frequency.lfhf` + `quality.analyzablePct` + `timeseries.epochs[].position` + `sleep.stageMinutes`; PPG:
`hrv.time.{rmssd,sdnn}` (whole-record) + `lfhf` + `quality` + limb-acc `epochs[].position`. The two nodes did
NOT diverge (the entire reason this handoff exists). Two new Dex-Test-Suite groups (ECG + PPG twins) lock:
default-light unchanged · rich consensus axis present · `adaptEnvelopeNode` picks up `summary.rmssd/sdnn` ·
`epochs[].position` → posture series. Re-bundled BOTH external-JS-only — ECGDex `bfa1aa934fcc→0aaaa23062d4`,
PpgDex `c7c808bbb6a1→b6155e9b3cdb` (buildHash UNCHANGED on both); `BUILD-MANIFEST.json` GATE A + both
`*_equiv` `FIXTURE-PROVENANCE.json` manifestHashes updated (LIGHT fixtures export-inert → NOT regenerated).
Dex-Test-Suite all-green **1119/71**; verify-provenance GATE A 8/8 + GATE B reproducible. No new residue
surfaced beyond what the two child briefs already track.

**§2 step 2 — (b) companion-bundle ingest — DONE (2026-06-27, both nodes, both gates green).** The single-text
adapter boundary dropped each node's device sidecars; lifted the apps' `loadFiles` nearest-by-stamp pairing into
ONE shared helper (`signal-orchestrate.pairCompanions` / `streamKind` / `fnameStampMs`) that BOTH hosts (Data
Unifier · OverDex) call, handing the matched companion TEXT to the adapter via `ctx.companions`. Each adapter
parses + attaches them to the frame so `compute()` carries them — ECG `*_RR/_HR/_ACC` → `rec.deviceRR/HR/ACC`
(NEW DSP-resident `parseDeviceRR/HR/ACC` in `ecgdex-dsp.js`, Clock-Contract-faithful regex `parseTimestamp`,
mirroring PpgDex's `parseSensorXYZ/parseDevicePPI`); PPG `*_ACC/_GYRO/_MAGN/_PPI` → `rec.acc/gyro/magn/devicePPI`
(REUSE the existing PPGDSP parsers → NO `ppgdex-dsp.js` change → NO PpgDex re-bundle). `analyze()` turns
`rec.deviceACC` into REAL `epochs[].position` (posture) — filling the (a) scaffold (was all-'unknown' on the
companion-less path). New Dex-Test-Suite group *"Companion-bundle ingest"* locks the nearest-by-stamp pairing +
the adapter attach (with/without companions, frame stays schema-valid) + the deviceACC→posture payoff for both
nodes. ECGDex re-bundled external-JS-only (the device parsers) `da5134a91410→c8eb64808061` (buildHash
`146ac9c8b1bd` UNCHANGED; the equiv fixture is export-inert — the device parsers never run on the companion-less
`compute({text})` path → manifestHash re-recorded, not regenerated). The adapters + hosts + `signal-orchestrate`
are loose `<script src>` (Data Unifier/OverDex are NOT bundled) → no re-bundle for those. Dex-Test-Suite all-green
**1158/75**; verify-provenance GATE A 8/8 + GATE B reproducible.

**Still OPEN — this handoff stays IN-PROGRESS until the children fully close:**
- **DISCOVERED residue (from (b)) — RESOLVED 2026-06-27 by `HOST-EMIT-ALLOWLIST-2026-06-27-BRIEF.md`.** Both
  hosts gated the LIVE emit button to a hardcoded `rr/spo2/hrv` literal (Data Unifier `canEmit` / the OverDex
  auto-emit allowlist), so `ecg/ppg/cgm` were NOT emitted in the live UI — a pre-existing gap broader than (b)
  (it also blocked GlucoDex/cgm). Fixed with ONE shared `SignalOrchestrate.canEmit` predicate both hosts gate
  on; gates green 1176/75. Residual: a manual live-drop eyeball of the companion path is still standing debt,
  now unblocked (drops actually emit an export to inspect).
- **§2 step 3 — node-independent remainders.** ECGDEX-II §3 (committed event byte-fixture — DECIDED keep the
  live gate), §4 (co-load generation step, before/with CPAPDex), §5/§6; PPGDEX §2 (PPG light-export
  Integrator-verify, the twin of ECGDEX-I §2), `sampEn` O(N²) cap, the LOW items. (ECGDEX-II §1 Pan-Tompkins
  search-back + §7 cross-check are DONE.)

Both coupled pieces (a)+(b) — the reason this handoff exists — are now landed. Flip this header + both children
to DONE when the node-independent remainders close.

## 0 · Read order (do not skip)
1. **`CLAUDE.md`** — the two gates, the Clock Contract, frozen `Ganglior`/`fascia`, edit-`*.js`/`.src.html`-
   then-re-bundle. Non-negotiable.
2. **`CONTRIBUTING.md`** §"what-to-edit" table + the re-bundle ritual.
3. The two child briefs in full: **`PPGDEX-FOLLOWUPS-2026-06-27-BRIEF.md`** and
   **`ECGDEX-FOLLOWUPS-II-2026-06-27-BRIEF.md`**.
4. For context on WHY the impl was deferred (not skipped): `ECGDEX-FOLLOWUPS-2026-06-27-BRIEF.md`
   execution log (§1 DECIDED option (a); §2 PROVED the interim light path degrades gracefully, so the
   deferral is safe, not a regression).

## 1 · ⚠ THE COUPLING — `PPGDEX-FOLLOWUPS §1` ≡ `ECGDEX-FOLLOWUPS-II §2` (the one thing you must not split)
Both nodes have the IDENTICAL gap: the Unifier/OverDex orchestrate export is **companion-less + light** —
the single-text adapter boundary drops the device companions, and `*BuildNodeExport` emits only
`recording` + `ganglior_events`, so an Integrator-routed file loses HRV consensus + posture (PpgDex also
loses its motion gate; ECGDex also loses morphology/sleepStages + device cross-checks). The ECGDex -I
pass already **DECIDED option (a)** (carry the richer fields, gated) and **deferred the code specifically
to do it jointly here.** So:

- **Design the rich-export shape ONCE, apply to BOTH** `ppgBuildNodeExport` and `ecgBuildNodeExport`.
  Carry `hrv.time` (incl. the whole-record `wholeRecordRMSSD/SDNN` the Integrator's consensus axis reads)
  + `timeseries.epochs[].position` (+ `sleepStages` for ECG), **gated behind an opts flag** so each app's
  light `exportGanglior` stays **byte-identical** (the app calls WITHOUT the flag; only `emitPpgNodeExport`
  / `emitEcgNodeExport` pass it). Verify the matching `adaptEnvelopeNode` branches now pick up
  `rmssd/sdnn/posture` (extend the ECGDEX-FOLLOWUPS-I group 12d + add the PpgDex twin).
- **Do NOT land one node's (a) without the other** — divergent export shapes across the two HRV-bearing
  raw-signal nodes is precisely what "align with the sibling decision" forbids.
- **(b) companion-bundle ingest** (device `*_RR/_HR/_ACC` for ECG, `*_ACC/_GYRO/_MAGN/_PPI` for PPG) is a
  SHARED mechanism too — both apps' `loadFiles` already do nearest-by-stamp pairing; lift it into a
  multi-file adapter entry (or pass siblings via `ctx`) ONCE. Larger; may be its own sub-pass AFTER (a).

## 2 · Suggested sequence
1. **Coupled (a) export-enrichment** for PpgDex + ECGDex (above) → re-bundle BOTH → gates.
2. **(b) companion-bundle ingest** (shared multi-file adapter mechanism), if in scope.
3. **Node-independent remainders** (no coupling — any order):
   - **ECGDEX-FOLLOWUPS-II §1** — Pan-Tompkins **search-back** (the GENERAL mid-file threshold-stuck case;
     the shipped seed fix covered only startup). DSP edit → re-bundle ECGDex → gates. Independent of the
     export work — can be done first if you want a quick, self-contained win.
   - **ECGDEX-FOLLOWUPS-II** §3 (committed event byte-fixture), §4 (co-load GENERATION step — do
     before/with CPAPDex), §5 (overnight orchestrate perf cap), §6 (live-drop + Node-CI debt).
   - **PPGDEX-FOLLOWUPS** §2 (Integrator `adaptPpgDex` light-export verify — mirror ECGDEX-I §2), the
     uncapped O(N²) `sampEn` cap, and its LOW items.

## 3 · Gate ritual — after EVERY node you touch (CLAUDE.md / CONTRIBUTING.md)
1. Edit `<node>-dsp.js` / `<node>-app.js` / `<Node>.src.html` — **never** the bundled `<Node>.html`.
2. Re-bundle `<Node>.src.html` → `<Node>.html` via the inliner (`super_inline_html`).
3. `Dex-Test-Suite.html` — wait to settle, `#summary` must be **all-green** (a lone ECGDex iframe-boot /
   OxyDex watchdog red is a known flake — re-run isolated).
4. `verify-provenance.html` — no red; read the **`manifestHash`** column (moves on any bundled-module
   change; `buildHash` may NOT move for external-JS-only edits).
5. **Hand-update that app's `manifestHash` in `BUILD-MANIFEST.json`** (GATE A hard-fails on stale).
6. If you changed CODE, regenerate fixtures by **re-running the app + re-exporting** (never hand-edit),
   then record the producing bundle's `manifestHash` in `FIXTURE-PROVENANCE.json` (GATE B). The (a)
   export change MOVES the orchestrate export → budget for the equiv fixtures and add an `*_events` /
   `*_rich` fixture as needed.
7. Flip each child brief's header `Status:` to DONE when fully executed; sync `DOCS-INDEX.md`; spawn a
   `-FOLLOWUPS`/`-II` for any new residue. Flip THIS handoff to DONE when both children are DONE.

## Done when
- `PPGDEX-FOLLOWUPS-2026-06-27-BRIEF.md` and `ECGDEX-FOLLOWUPS-II-2026-06-27-BRIEF.md` are both
  `Status: DONE`, the (a) export shape is identical across both nodes, both gates are green, and
  `BUILD-MANIFEST.json` + `FIXTURE-PROVENANCE.json` are current.
