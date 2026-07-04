<!--
  CPAPDEX-PHASE9-FOLLOWUPS-III-2026-06-28-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-06-28 · **Created:** 2026-06-28 · **Follows:** `CPAPDEX-PHASE9-FOLLOWUPS-2026-06-28-BRIEF.md` (-I, fixtures) + `CPAPDEX-PHASE9-FOLLOWUPS-II-2026-06-28-BRIEF.md` (-II, gate coverage), both DONE 2026-06-28 · **Parent:** `SIGNAL-ADAPTER-PHASE9-REMAINING-NODES-2026-06-25-BRIEF.md` (CPAPDex leg, node 4/4) · **Spawned (residue):** `CPAPDEX-PHASE9-FOLLOWUPS-IV-2026-06-28-BRIEF.md` · **Relates:** `docs-archive/retired-fixtures/README.md` (`cpapdex-multi17` retirement), `CPAPDEX-BUILD-BRIEF.md` §6 (multi-night export)

# CPAPDex Phase-9 — follow-ups III (residue from executing -I + -II)

> **✅ Executed 2026-06-28.** **§1 (LOW — the work):** added a DETERMINISTIC synthetic **multi-night** golden gate.
> Committed `uploads/cpapdex_synthetic_multinight_golden.node-export.json` = **3** nights from `CpapDsp._synthEdfSet({oxi:true,cs:true})`
> each shifted by a WHOLE day (Clock Contract: floating `tMs`; a whole-day shift keeps the wall-clock time-of-day but
> advances `dateAnchorMs` → distinct nights, so `buildNight` keeps them separate) → per-night `buildNight([buildSessionFromEdf(set)])`
> → the **IDENTICAL** envelope `exportNight` builds (`schema.multiNight:true` + `nightCount` + `crossNight:CPAPCross.crossNightBlock(chrono)`
> + `nights:chrono.map(cpapBuildExport)`), FULL-tree deep-diffed inside the equivalence-gate group reusing its `diff`+`EXCL`
> (`file/provenance/kernel/generated`; the crossnight envelope's own `crossNight.schema.generated` stamp is stripped by the same
> `generated` key), wired into BOTH runners via `env.equiv.cpapdex_multinight_golden`. **Chose the in-test reconstruction
> (Caveat option B) over the shared-helper lift (A) → NO re-bundle;** because `exportNight` INLINES the envelope, a **SOURCE-PIN**
> on `cpapdex-app.js` (4 regex asserts: `multiNight:true` · `nightCount:` · `crossNight:…crossNightBlock(` · `nights:chrono.map`+`cpapBuildExport(`)
> reds if the app's wrapper shape drifts → forces the reconstruction + the golden to be regenerated in lock-step (the app-drift
> teeth a bare in-test copy lacks → satisfies "a deliberate wrapper-shape change must require regenerating it" WITHOUT a re-bundle).
> **⚠ DISCOVERED (verify-don't-trust): `cpapdex-cross.js` / `CPAPCross` was NOT co-loaded at RUNTIME in EITHER runner before this
> brief** — only its SOURCE text was fetched (for the P12 cross-Dex drift gate). So the brief's "`CPAPCross.crossNightBlock` has its
> own unit coverage" was imprecise: coverage was source-level (P12 byte-identity vs the other `*-cross.js`) + the shared `crossNight`
> ENGINE's ECGCross runtime tests — there was NO `CPAPCross` runtime assertion. Now co-loaded in BOTH runners (`<script src>` in
> `Dex-Test-Suite.html` + the optional batch in `run-tests.mjs`) + added to `env`, and the multi-night golden exercises
> `crossNightBlock` end-to-end. Code-gated in `FIXTURE-PROVENANCE.json` (`{bundle:'CPAPDex.html', manifestHash:'75d4c6dee9b6'}`).
> **§2** (`compute()` drops `opts`) — owner-gated (no live routing); left as the recorded known divergence, NOT fixed. **§3**
> (`cross.js` self-describing evidence · Node-CI) — carried fleet-wide/standing. **Gates:** TEST/FIXTURE-ONLY — **NO re-bundle**
> (`BUILD-MANIFEST.json` + every bundle's `manifestHash`/`buildHash` unchanged) → `Dex-Test-Suite.html` all-green **1339/83**;
> `verify-provenance.html` GATE A **8/8** (CPAPDex `75d4c6dee9b6` unchanged) + GATE B the new multi-night golden
> `reproducible ✓ (code-gated)`. Residue (`CPAPCross` still has no DEDICATED runtime unit test now that it's co-loaded; the shared
> `cpapBuildMultiNightExport` lift remains a re-bundle-gated cleanup that would drop the source-pin) → `CPAPDEX-PHASE9-FOLLOWUPS-IV`.

> **Read `CLAUDE.md` first** (the two gates, the Clock Contract, the re-bundle ritual), then -I and -II. **No code
> defect — both gates were green after -I/-II** (`Dex-Test-Suite.html` all-green; `verify-provenance.html` GATE A 8/8
> + GATE B code-gated). This brief captures the residue surfaced WHILE executing -I/-II: one new coverage gap opened
> by a deliberate retirement (§1), one latent divergence carried forward unchanged (§2), and the standing fleet-wide
> debts (§3). Everything here is LOW / hardening; nothing blocks the -I/-II DONE stamps. Verify, don't trust.

## 0 · Context — what -I/-II actually did (verify, don't trust)
- **-I §1:** the two SINGLE-NIGHT CPAPDex fixtures (`cpapdex-2026-06-12.node-export.json`, `cpapdex-2026-06-16.json`)
  were re-run on their committed AirSense EDF sets via the loose modules (≡ `CPAPDex.html` @ manifestHash
  `75d4c6dee9b6`), reproduced **byte-identical**, and are now **code-gated** in `FIXTURE-PROVENANCE.json` (left as-is
  per the EXPORT-INERT precedent). The 17-night `cpapdex-multi17-2026-06-16.json` was **RETIRED** to
  `docs-archive/retired-fixtures/` — its source EDFs were never committed and `exportNight`'s multi-night wrapper
  needs ≥3 nights while the committed inputs yield only 2, so it is not faithfully regenerable.
- **-II §1/§2/§4:** golden-export reference gate added (`uploads/cpapdex_synthetic_golden.node-export.json`, full-tree
  diff in BOTH runners via `env.equiv.cpapdex_golden`); `readEDF → compute()` floor case added; stale self-gate
  comment tidied. **-II §3:** `compute(input, opts)` still drops `opts` — recorded as a known divergence, NOT fixed.
- Both were **test/fixture-only — NO re-bundle**, so `BUILD-MANIFEST.json` + every bundle's `manifestHash`/`buildHash`
  are unchanged, and no other node's fixtures flipped.

---

## 1 · LOW (coverage gap opened by -I §1) — the multi-night export wrapper now has NO fixture

`cpapdex-multi17` was the only committed fixture exercising `cpapdex-app.js exportNight`'s **multi-night branch**
(`chrono.length >= 3` → a `schema.multiNight:true` envelope = `{ kernel, schema, generated, nightCount,
crossNight: CPAPCross.crossNightBlock(chrono), nights: chrono.map(cpapBuildExport) }`). Retiring it (correct — it was
not regenerable) leaves that array-assembly + `ganglior.crossnight` header path **ungated by any fixture**. The
single-night `cpapBuildExport` tree is now pinned by the -II §1 golden, and `CPAPCross.crossNightBlock` has its own
`cpapdex-cross.js` unit coverage, but the **wrapper that stitches N per-night exports + the crossnight header** is not
diffed against a reference anywhere.

- **Do (recommended — a deterministic synthetic multi-night golden, mirrors -II §1):** in `tests/dex-tests.js`, build
  **≥3** deterministic nights — e.g. `CpapDsp._synthEdfSet({oxi,cs})` with the per-night `t0` shifted by ≥1 day each
  (so `buildNight` keeps them as distinct nights) → one `buildNight([buildSessionFromEdf(set)])` per night → assemble
  the SAME multi-night envelope `exportNight` builds (the `nights:` map + `CPAPCross.crossNightBlock(chrono)` header) →
  deep-diff the full tree (reuse the equivalence gate's `diff` + `EXCL`) against a committed
  `uploads/cpapdex_synthetic_multinight_golden.node-export.json`. Wire into BOTH runners via a new `env.equiv` key;
  code-gate the fixture in `FIXTURE-PROVENANCE.json` (`{bundle:'CPAPDex.html', manifestHash:'<current>'}`).
  **Caveat:** factor the envelope assembly so the gate calls the SAME code `exportNight` uses (today the envelope is
  inlined in `exportNight` — either lift it into a shared `cpapBuildMultiNightExport(chrono)` the app delegates to, OR
  reconstruct the identical shape in the test and accept the small duplication). The clock shift must respect the
  Clock Contract (floating `tMs`; distinct `dateAnchorMs` per night). No re-bundle if you only reconstruct in-test; a
  re-bundle IS required if you lift a shared `cpapBuildMultiNightExport` into `cpapdex-app.js`/`-fusion.js` (then
  update `BUILD-MANIFEST.json` + regenerate the affected fixtures' `manifestHash` per the ritual).

## 2 · LOW (latent, carried from -II §3 / -I §2) — `CPAPDex.compute(input, opts)` still DROPS `opts`

`signal-orchestrate.emitCpapNodeExport` passes `opts = { kernel, ingest, fname, offsetMin }` to `compute()`, but
`compute()` runs `_nightFromInput(input)` then `CpapFusion.cpapBuildExport(night)` — **`opts` is never threaded
through**, so an orchestrate/adapter-supplied `adapter`/`vendor`/`via` ingest stamp is lost (the other migrated nodes
thread `opts.ingest` into their export). This is **latent** today because CPAPDex has **no live host routing** (-I §2:
binary multi-file EDF can't traverse the `readAsText` ingest boundary, so nothing supplies a real `ingest`). -II §3
RECORDED it (a comment at the floor's parity assert + the -II header) rather than fixing it.

- **Do (only WITH -I §2, when/if live-host EDF routing lands — owner-gated):** give `cpapBuildExport(night, opts)` an
  optional trailing `opts` that merges `opts.ingest` into `schema.provenance` (ADDITIVE — the app passes nothing →
  byte-identical, fixtures stay inert), and have `compute()` forward its `opts`. This touches a **bundled module**
  (`cpapdex-fusion.js`), so it forces a CPAPDex re-bundle → update `BUILD-MANIFEST.json` + re-record the three CPAPDex
  fixtures' `manifestHash` in `FIXTURE-PROVENANCE.json` (the export stays byte-identical when the app passes no `opts`,
  so the fixtures are NOT regenerated — only the producing-bundle `manifestHash` is re-recorded). Until then, the
  divergence is the recorded known state; do not mistake the floor's `compute() ≡ cpapBuildExport` parity for
  full input→export fidelity.

## 3 · LOW (carried, NOT new — fleet-wide / standing debt)
- **`cross.js` self-describing crossnight evidence** (`-I §3`): `cpapdex-cross.js` (like every other node's `*-cross.js`)
  does not yet write self-describing `evidence` on each crossnight-envelope metric so the Integrator can badge CPAPDex
  longitudinal trends. Fleet-wide, not CPAPDex-specific — track with the existing cross.js-evidence debt; do **not**
  open a CPAPDex-only tracker.
- **Node-CI standing debt** (`-I §4` / `GENERIC-EMIT-GATE-FOLLOWUPS-II §1`): `node tests/run-tests.mjs` is not run in
  this environment (no Node host); the CPAPDex co-load + the new `env.equiv.cpapdex_golden` wiring were added to
  `run-tests.mjs` for parity, but verification was via the same-origin `Dex-Test-Suite.html` substitute gate. Same
  standing debt as every prior leg — co-tracked; do not open a new tracker.

---

## Done when (whole brief)
- §1 a deterministic synthetic **multi-night** golden gate exists (or the multi-night wrapper is otherwise pinned to a
  reference), wired into BOTH runners, green; a deliberate wrapper-shape change must require regenerating it.
- §2 the `opts`-drop is either FIXED (when live routing lands, with the re-bundle + manifestHash re-record ritual) or
  remains the explicitly-recorded known divergence (no further action required until routing lands).
- §3 remains co-tracked with the fleet-wide cross.js-evidence + Node-CI debts (no CPAPDex-only tracker).
- Gates stay green: `Dex-Test-Suite.html` all-green · `verify-provenance.html` GATE A/B clean. §1 in-test-only = no
  re-bundle; §1-with-shared-helper or §2 = re-bundle CPAPDex + update `BUILD-MANIFEST.json` per the ritual.

### Priority summary
- **LOW (coverage):** §1 (multi-night export wrapper lost its only fixture when `cpapdex-multi17` was retired — add a
  deterministic synthetic multi-night golden).
- **LOW (latent):** §2 (`compute()` drops `opts` — fix only when live routing lands, owner-gated, re-bundle).
- **LOW (carried):** §3 (`cross.js` self-describing evidence — fleet-wide; Node-CI — standing).
