<!--
  CPAPDEX-PHASE9-FOLLOWUPS-IV-2026-06-28-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-06-29 (§2 lift additionally executed 2026-06-29, paired with OXYDEX-NODE-EXPORT-ENVELOPE-FOLLOWUPS-II §1) · **Created:** 2026-06-28 · **Follows:** `CPAPDEX-PHASE9-FOLLOWUPS-III-2026-06-28-BRIEF.md` (-III, the multi-night golden gate) · **Parent:** `SIGNAL-ADAPTER-PHASE9-REMAINING-NODES-2026-06-25-BRIEF.md` (CPAPDex leg, node 4/4) · **Relates:** `CPAPDEX-PHASE9-FOLLOWUPS-II-2026-06-28-BRIEF.md` §3 (the `opts`-drop), the P12 cross-Dex drift gate (`tests/dex-tests.js` ~L1402), the ECGCross runtime crossNight group (`tests/dex-tests.js` ~L94)

> **EXECUTED 2026-06-29 (docs-only close-out — NO code/test/bundle change; verify-don't-trust):** §1 confirmed
> **DONE-by-subsumption** — `CROSS-MODULE-RUNTIME-COVERAGE-2026-06-28-BRIEF.md` (Status: DONE — 2026-06-29) shipped
> the fleet-wide `Cross §1 — per-node crossNightBlock + helpers (VARYING series)` group whose **CPAPDex** leg
> (`tests/dex-tests.js` ~L3124–3135) asserts exactly what this §1 asked, **source-verified by grep not trusted**:
> `CPAPCross.crossNightBlock` over a VARYING 8-night series · `CrossNightEnvelope.validate(block).ok` · the full
> `CPAP_DEFS` id set (`centralIndex·largeLeakPct·odi·residualAHI·usageHours`) · `usageHours`↑+good:up→improving ·
> `residualAHI`↓+good:down→improving · `compliancePct`(all ≥4 h)→100% · `nightOdi`=mean of oximeter-available
> sessions — wired into BOTH runners. §2 = the **accepted final deferral**: the -III in-test reconstruction of
> `exportNight`'s envelope + the 4-assert source-pin is sufficient (app-drift teeth with NO re-bundle); the cleaner
> shared-`cpapBuildMultiNightExport(chrono)` lift (app delegates → gate calls the SAME code → drop the source-pin;
> also lets multi-night `compute()`/orchestrate emit) **remains available as a deliberate re-bundle-gated refactor**
> (full instructions in §2 below) — NOT done here, by design. §3 stays co-tracked with the fleet-wide debts
> (opts-drop owner-gated · `cross.js`-evidence fleet-wide · Node-CI `env.equiv`) — no CPAPDex-only tracker.
> **Gates:** this close-out edits ONLY markdown (this header + the `DOCS-INDEX.md` row) → code/test/bundle-**INERT**
> (no `BUILD-MANIFEST.json` / `manifestHash` / fixture touched), so both gates remain green per the same-day
> subsuming DONE passes — `CROSS-MODULE-RUNTIME-COVERAGE` `Cross §1` 27/27, `-FOLLOWUPS-II` `Dex-Test-Suite`
> all-green 1394/86, `OXYDEX-NODE-EXPORT-ENVELOPE` 1477/93 + `verify-provenance` GATE A 8/8 + GATE B clean.
> **No new residue → no -V** (§2 is a pre-existing documented deferral; §3 is carried).

# CPAPDex Phase-9 — follow-ups IV (residue from executing -III)

> **Read `CLAUDE.md` first** (the two gates, the Clock Contract, the re-bundle ritual), then -III. **No code defect —
> both gates were green after -III** (`Dex-Test-Suite.html` all-green **1339/83**; `verify-provenance.html` GATE A **8/8**
> + GATE B the new multi-night golden `reproducible ✓ (code-gated)`). This brief captures the residue surfaced WHILE
> executing -III: one coverage observation the -III RUNTIME co-load of `CPAPCross` exposed (§1), one deliberate
> design deferral -III chose (§2), and the standing carried debts (§3). Everything here is **LOW / hardening**;
> nothing blocks the -III DONE stamp. Verify, don't trust.

## 0 · Context — what -III actually did (verify, don't trust)
- **-III §1:** committed `uploads/cpapdex_synthetic_multinight_golden.node-export.json` (3 `CpapDsp._synthEdfSet({oxi,cs})`
  nights, each shifted a WHOLE day → per-night `buildNight([buildSessionFromEdf(set)])` → the IDENTICAL envelope
  `cpapdex-app.js exportNight()` builds for `chrono.length >= 3`), full-tree deep-diffed inside the equivalence-gate group
  (reusing its `diff`+`EXCL`), wired into BOTH runners via `env.equiv.cpapdex_multinight_golden`, code-gated in
  `FIXTURE-PROVENANCE.json` (`{bundle:'CPAPDex.html', manifestHash:'75d4c6dee9b6'}`). Chose **option B** (in-test
  reconstruction) over **option A** (lift a shared builder) → **NO re-bundle**; a **SOURCE-PIN** on `cpapdex-app.js`'s
  `exportNight` (4 regex asserts) reds on wrapper-shape drift so the golden + reconstruction regenerate in lock-step.
- **-III discovery:** `cpapdex-cross.js` / `CPAPCross` was NOT runtime-co-loaded in EITHER runner before -III (only its
  source text was fetched, for the P12 cross-Dex drift gate). -III added `<script src="cpapdex-cross.js">` to
  `Dex-Test-Suite.html`, `'cpapdex-cross.js'` to the `run-tests.mjs` optional module batch, and `CPAPCross` to `env` in
  both. It also added `'cpapdex-app.js'` to both source lists (for the source-pin).
- **Gates:** TEST/FIXTURE-ONLY — NO re-bundle (`BUILD-MANIFEST.json` + every bundle's `manifestHash`/`buildHash`
  unchanged), no other node's fixtures flipped.

---

## 1 · LOW (coverage, exposed by the -III runtime co-load) — `CPAPCross` has NO DEDICATED runtime unit test

> **NOTE (2026-06-28):** this item is the CPAPDex instance of a FLEET-WIDE gap — see
> `CROSS-MODULE-RUNTIME-COVERAGE-2026-06-28-BRIEF.md` §1, which SUBSUMES this §1 (do the cross-module
> pass once, fleet-wide, rather than only for CPAPDex).
>
> **✅ EXECUTED-BY-SUBSUMPTION 2026-06-29:** `CROSS-MODULE-RUNTIME-COVERAGE §1` shipped the fleet-wide
> `Cross §1 — per-node crossNightBlock + helpers (VARYING series)` group, whose CPAPDex assertions cover
> exactly what this §1 asked for — `CPAPCross.crossNightBlock` over a VARYING multi-night series (good:up
> usageHours→improving, good:down residualAHI→improving), `CrossNightEnvelope.validate(block).ok`, the full
> `CPAP_DEFS` id set, plus `nightOdi` (mean of oximeter-available sessions) and `compliancePct` (all-≥4 h →
> 100%). 27/27 green, both runners, NO re-bundle. **This §1 is DONE.** (The whole -IV brief stays open: §2
> = the re-bundle-gated `cpapBuildMultiNightExport` lift, still a deferral; §3 = carried debts.)

-III had to ADD the runtime co-load of `cpapdex-cross.js` because it wasn't there — meaning before -III, `CPAPCross`'s
`crossNight()` / `crossNightBlock()` had **no runtime assertion at all** in the shared suite. Its math is covered only
**transitively**: (a) the **P12 cross-Dex source-drift gate** asserts CPAPDex's `crossNight` is byte-identical (the
mirrored significance rule) to the other `*-cross.js` — *source* identity, not behaviour; (b) the **shared `crossNight`
ENGINE** has a runtime group, but it runs against **ECGCross** (`tests/dex-tests.js` ~L94, "Cross-night baseline
mean/sd"), trusting byte-identity to cover the siblings; (c) the **-III multi-night golden** now exercises
`CPAPCross.crossNightBlock` end-to-end, but only on ONE deterministic 3-identical-night fixture (so `sd:0`, `trend:'stable'`,
`headline:[]` — it does NOT exercise a rising/declining trend, a significant Mann-Kendall, a non-trivial z-score, or the
CPAP-specific `CPAP_DEFS` outcome `get`/`goodDirection`/`nightOdi` wiring).

- **Do (cheap, test-only, NO re-bundle):** add a dedicated `CPAPCross` group to `tests/dex-tests.js` mirroring the
  ECGCross "Cross-night baseline mean/sd" group — drive `CPAPCross.crossNight(series, {good})` on a short VARYING series
  (improving residual-AHI, declining usage) and assert mean/sd/slope/τ/zLatest + the `trendLabel` good-direction logic,
  and drive `CPAPCross.crossNightBlock` over ≥3 synthetic nights with DIFFERING metrics to assert the per-`CPAP_DEFS`
  metric shaping (incl. `nightOdi` = mean of oximeter-available sessions, null when no oximeter that night). Both
  `CPAPCross` and `CrossNightEnvelope` are already in `env` in both runners (-III). Localizes a CPAPDex crossNight
  failure to the node instead of inferring it from the ECGCross group + P12 source identity.

> **✅ EXECUTED 2026-06-29 (the option-A lift was taken):** paired with `OXYDEX-NODE-EXPORT-ENVELOPE-FOLLOWUPS-II §1`
> (which re-bundles CPAPDex anyway), `cpapBuildMultiNightExport(chrono)` was lifted into `cpapdex-fusion.js` beside
> `cpapBuildExport` — reads `global.CPAPCross` / `GangliorProvenance` / `DexKernel` at call time and returns the exact
> `{ kernel, schema{…multiNight:true…}, generated, nightCount, crossNight:CPAPCross.crossNightBlock(chrono),
> nights:chrono.map(cpapBuildExport) }` shape `exportNight` inlined. `cpapdex-app.js` `exportNight` now DELEGATES to
> it; the `Dex-Test-Suite` multi-night golden gate calls the SAME shared builder and the **in-test reconstruction +
> 4 exportNight source-pin regex asserts were REMOVED** (a wrapper change now moves the one shared function → the
> golden diff reds directly). CPAPDex re-bundled; the 4 CPAPDex fixtures' `manifestHash` re-recorded in
> `FIXTURE-PROVENANCE.json`. Delegation is behavior-preserving — the multi-night golden's only content move is the
> paired §1 `desat`→`desat_event`. `Dex-Test-Suite` green. (⚠ `verify-provenance` GATE A fleet-drift caveat: see
> OXYDEX-NODE-EXPORT-ENVELOPE-FOLLOWUPS-II's EXECUTED note — pre-existing, not from this lift.)

## 2 · LOW (design deferral -III chose) — the multi-night envelope is RECONSTRUCTED in-test, not lifted to a shared builder

-III pinned the multi-night wrapper via an **in-test reconstruction** of `exportNight`'s INLINED envelope + a SOURCE-PIN
(option B, no re-bundle). The cleaner shape — the -III Caveat's **option A** — is to lift a shared
`cpapBuildMultiNightExport(chrono)` into `cpapdex-fusion.js` (next to `cpapBuildExport`) that BOTH the app's `exportNight`
AND the gate call, so the gate exercises the **SAME code** the app runs and the source-pin can be **dropped** (a wrapper
change moves the one shared function → the golden diff reds directly). It would also let `CPAPDex.compute()` /
`signal-orchestrate` emit a multi-night export later without re-inlining the envelope. Deferred because it touches a
**bundled module** (re-bundle cost), and the source-pin already gives the no-re-bundle path app-drift teeth.

- **Do (only as a deliberate refactor pass — re-bundle-gated):** lift `cpapBuildMultiNightExport(chrono)` into
  `cpapdex-fusion.js` (returning the exact `{ kernel, schema:{…multiNight…}, generated, nightCount,
  crossNight:CPAPCross.crossNightBlock(chrono), nights:chrono.map(cpapBuildExport) }` shape — read `global.CPAPCross` /
  `global.GangliorProvenance` / `global.DexKernel` at call time, as `exportNight` does), have `exportNight` delegate to
  it, and switch the -III gate to call the shared builder (delete the in-test reconstruction + the 4 source-pin asserts).
  This re-bundles CPAPDex → update `BUILD-MANIFEST.json` + re-record the FOUR CPAPDex fixtures' `manifestHash` in
  `FIXTURE-PROVENANCE.json` per the ritual (the exports stay byte-identical — delegation is behavior-preserving — so the
  fixtures are NOT regenerated; only the producing-bundle `manifestHash` is re-recorded). Honor both gates.

## 3 · LOW (carried, NOT new — standing/fleet-wide)
- **`compute(input, opts)` drops `opts`** (`-II §3` / `-III §2`): owner-gated (CPAPDex has no live-host EDF routing —
  binary multi-file EDF can't traverse the `readAsText` ingest boundary, `-I §2`). Remains the explicitly-recorded known
  divergence; thread `opts.ingest` into `cpapBuildExport(night, opts)` only IF/WHEN live routing lands (re-bundle). No
  action until then.
- **`cross.js` self-describing crossnight evidence** (`-I §3` / `-III §3`): `cpapdex-cross.js` (like every node's
  `*-cross.js`) does not yet write self-describing `evidence` on each crossnight-envelope metric. Fleet-wide; track with
  the existing cross.js-evidence debt — do NOT open a CPAPDex-only tracker. (Note: `CPAP_DEFS` DO carry per-metric
  `evidence:'validated'`, passed into `CrossNightEnvelope.build` → each crossnight metric already has an `evidence`
  field; the fleet-wide gap is the Integrator's BADGING consumption of it, not the field's presence.)
- **Node-CI standing debt** (`-I §4` / `GENERIC-EMIT-GATE-FOLLOWUPS-II §1`): `node tests/run-tests.mjs` is not run in this
  environment (no Node host); the -III `cpapdex-cross.js` co-load + `CPAPCross` env export + `env.equiv.cpapdex_multinight_golden`
  wiring were added to `run-tests.mjs` for parity, verified via the same-origin `Dex-Test-Suite.html` substitute gate.
  Same standing debt as every prior leg — co-tracked; do not open a new tracker.

---

## Done when (whole brief)
- §1 a dedicated `CPAPCross` runtime group exists (`crossNight` + `crossNightBlock` over a VARYING multi-night series,
  asserting the stats + the `CPAP_DEFS` good-direction/`nightOdi` wiring), wired into BOTH runners, green.
- §2 either the shared `cpapBuildMultiNightExport` is lifted (with the re-bundle + `BUILD-MANIFEST` + 4-fixture
  `manifestHash` re-record ritual, the -III source-pin removed) OR it stays the recorded deferral (the in-test
  reconstruction + source-pin is sufficient; no further action).
- §3 remains co-tracked with the fleet-wide opts-drop (owner-gated) + cross.js-evidence + Node-CI debts (no
  CPAPDex-only tracker).
- Gates stay green: `Dex-Test-Suite.html` all-green · `verify-provenance.html` GATE A/B clean. §1 = test-only, no
  re-bundle; §2-with-lift = re-bundle CPAPDex per the ritual.

### Priority summary
- **LOW (coverage):** §1 (`CPAPCross` has no dedicated runtime unit test — its math is only transitively covered).
- **LOW (deferral):** §2 (multi-night envelope reconstructed in-test + source-pinned, not lifted to a shared builder —
  re-bundle-gated cleanup).
- **LOW (carried):** §3 (`opts`-drop owner-gated · `cross.js` evidence fleet-wide · Node-CI standing).
