<!--
  CPAPDEX-PHASE9-FOLLOWUPS-II-2026-06-28-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-06-28 · **Created:** 2026-06-28 · **Follows:** `CPAPDEX-PHASE9-FOLLOWUPS-2026-06-28-BRIEF.md` (-I, the execution residue) · **Parent:** `SIGNAL-ADAPTER-PHASE9-REMAINING-NODES-2026-06-25-BRIEF.md` (CPAPDex leg, node 4/4, DONE 2026-06-28) · **Spawned (residue):** `CPAPDEX-PHASE9-FOLLOWUPS-III-2026-06-28-BRIEF.md` · **Relates:** `GENERIC-EMIT-GATE-FOLLOWUPS-2026-06-28-BRIEF.md` §1 (frame-shape), the equivalence gate (`SIGNAL-ADAPTER-FOLLOWUPS-VI §1`)

# CPAPDex Phase-9 — follow-ups II (residue from a post-DONE "what do the new gates actually cover?" re-audit)

> **Read `CLAUDE.md` first** (the two gates, the Clock Contract, the re-bundle ritual), then `-I`. **No code
> defect — both gates were green at node-4/4 DONE** (`Dex-Test-Suite.html` 1312/81 all-green;
> `verify-provenance.html` GATE A 8/8, 0 red). This brief is a deliberate re-audit of the *coverage* the
> CPAPDex Phase-9 leg added: where `-I` captured execution residue (stale fixtures, no live routing, cross.js
> evidence, Node-CI), this captures **gate-completeness gaps in the new `compute()` path** — none blocking,
> all hardening. Every finding below was verified against the shipped code, not assumed.

> **✅ Executed 2026-06-28.** **§1 (⚠ MEDIUM)** — added the **golden-export reference gate** (option (a)): committed
> `uploads/cpapdex_synthetic_golden.node-export.json` = the deterministic synthetic night `CpapDsp._synthEdfSet({oxi:true,
> cs:true})` → `buildSessionFromEdf` → `buildNight` → `CpapFusion.cpapBuildExport`, FULL-tree deep-diffed inside the
> existing `Phase-9 compute() ≡ committed export` group **reusing its `diff` + `EXCL`** (file/provenance/kernel/generated),
> wired into BOTH runners via `env.equiv.cpapdex_golden` (`tests/run-tests.mjs` + `Dex-Test-Suite.html`). This pins the
> export OUTPUT, not just the `compute() ≡ cpapBuildExport` path-parity. **§2** — added a floor case chaining
> `CpapEdf._buildSyntheticEDF` → `readEDF` → `compute({edfSets:[decoded]})` → asserts schema-valid + a device-scored
> event surfaced from the decoded EVE annotation (pins the seam `_synthEdfSet` faked). **§3** — `compute(input, opts)`
> STILL drops `opts` (live-host routing has not landed, -I §2); recorded as a **known divergence** in a comment at the
> floor's parity assert (and here) so it isn't mistaken for full input→export fidelity — NOT fixed (no bundled-module
> touch; thread `opts.ingest` into `cpapBuildExport(night, opts)` when routing lands). **§4** — tidied the stale
> `cpapdex-dsp.js mirrors selfGateDesat` self-gate comment ("CPAPDex is not yet built" → "is built; assertion live").
> **Gates:** test/fixture-only — **NO re-bundle**, **NO `BUILD-MANIFEST.json` change** → `verify-provenance` GATE A 8/8
> unchanged + GATE B golden code-gated green; the golden + readEDF→compute logic verified **Node-parity green**
> (byte-identical full tree; `crossNode` deterministically null in both realms — no peers ingested in the shared suite).
> Residue → `CPAPDEX-PHASE9-FOLLOWUPS-III-2026-06-28-BRIEF.md`.

## 0 · Why a second brief (not folded into -I)
`-I` is the *execution* residue (fixtures/routing/cohesion). This is the *verification re-audit* residue — a
different class (what the gates prove vs. don't), surfaced only by stepping back after DONE. House pattern:
the post-DONE "did anything surface?" re-audit gets its own `-II` (cf. `GATE-LIVE-RUNNABILITY-FOLLOWUPS`).

---

## 1 · ⚠ HIGHEST (MEDIUM overall) — CPAPDex is the ONLY migrated node with NO content/reference equivalence gate

All six other migrated nodes have an entry in the `Phase-9 compute() ≡ committed export` **equivalence gate**
(`tests/dex-tests.js` `CASES` + `env.equiv` in both runners): a committed raw INPUT → `compute()` → deep-diff
vs a committed EXPORT fixture, pinning the node's output to a known-good reference. **CPAPDex is intentionally
absent** (verified: `tests/dex-tests.js` ~L2361 — the `CASES` array's `run: n.compute({text})` seam is
text/CSV-only, and CPAPDex's input is a BINARY multi-file EDF set). As a stand-in, the Phase-9 floor group
asserts `compute({edfSets:[set]}) ≡ CpapFusion.cpapBuildExport(buildNight([buildSessionFromEdf(set)]))`.

- **The gap:** that parity proves the two CODE PATHS **agree** (compute()'s `_nightFromInput` assembly ≡ the
  direct builder call) — it pins NEITHER to a reference output. Since the app's `exportNight` and `compute()`
  BOTH delegate to the same `CpapFusion.cpapBuildExport`, a silent regression IN that shared builder (e.g. a
  change to how it assembles `crossMetrics`, the `oximetry[]` array, the `sessions[]` mapping, or `quality`)
  drifts BOTH sides together → the parity assert stays green, and **no content gate catches it**. The
  node's metric *values* are gated by `cpapdex-dsp.js selfTest()` (AHI/leak/pressure/ODI asserts) and the
  *shape* by the floor (schema.name/node, finite startEpochMs, events array, device-scored ≥4) — but the full
  export ASSEMBLY (the cpapBuildExport tree beyond those fields) is unpinned.
- **Do (pick one):**
  - **(a) Golden-export gate (cheapest, recommended):** in `tests/dex-tests.js`, build a DETERMINISTIC night
    from `CpapDsp._synthEdfSet({oxi,cs})` → `CpapFusion.cpapBuildExport` → deep-diff against a committed
    `uploads/cpapdex_synthetic_golden.node-export.json` (reuse the equivalence gate's `diff` + `EXCL`
    file/provenance/kernel/generated). Regenerate the golden whenever you intentionally change the export
    shape. Wire it into BOTH runners. No bundle, no app change.
  - **(b) Binary-input equivalence variant:** commit a small real AirSense `.edf` set + its app export fixture,
    add a CPAPDex `CASES` entry whose `run` does `readEDF(buf)` per file → `compute({edfSets:[…]})` and diffs
    the physiological fields. Heavier (needs committed binary inputs + a binary read seam in the gate harness)
    but exercises the REAL ingest end-to-end (also closes §2). Tie to `FIXTURE-PROVENANCE.json` (code-gated).

## 2 · LOW — the `readEDF → compute()` seam is NOT gated end-to-end in the shared suite

The Phase-9 floor drives `CpapDsp._synthEdfSet` (a SYNTHETIC already-DECODED set), not `CpapEdf.readEDF`. The
binary decoder is gated SEPARATELY (`Leaf-module coverage` group → `CpapEdf.selfTest()`, which round-trips
`_buildSyntheticEDF` → `readEDF`). So readEDF✓ and compute(synthetic-set)✓ are each gated, but **nothing chains
`readEDF(real-shaped EDF) → compute()`** in the shared suite. A drift between `_synthEdfSet`'s decoded-set
shape and `readEDF`'s ACTUAL output (e.g. a signal-label or `clock`/`annotations` field rename) would pass the
floor yet break on real files (caught only by the browser-only render-coverage app boot, not Node CI).
- **Do:** add a floor case chaining `CpapEdf._buildSyntheticEDF(...)` (real EDF `ArrayBuffer`) → `readEDF` per
  file → `compute({edfSets:[decoded…]})` → assert schema-valid. Pins the seam `_synthEdfSet` currently fakes.
  (Subsumed by §1 option (b) if that path is taken.)

## 3 · LOW (latent — folds into -I §2) — `CPAPDex.compute(input, opts)` DROPS `opts` (ingest/fname/offsetMin)

`emitCpapNodeExport` passes `opts = { kernel, ingest, fname, offsetMin }` to `compute()`, but `compute()` only
uses `_nightFromInput(input)` then calls `CpapFusion.cpapBuildExport(night)` — **`opts` is never threaded
through.** The export's provenance comes ONLY from globals (`GangliorProvenance.stamp()` + `DexKernel`), so an
orchestrate/adapter-supplied `adapter`/`vendor`/`via` is LOST. The other migrated nodes (ECG/Ppg/Gluco) thread
`opts.ingest` into the export. **Latent today** (CPAPDex has no live routing — `-I` §2), so nothing supplies a
real ingest; harmless. **Do (with -I §2, when/if live routing lands):** give `cpapBuildExport(night, opts)` an
optional `opts` that merges `opts.ingest` into `schema.provenance` (additive, app passes nothing → byte-
identical), and have `compute()` forward it. Until then, record the divergence so it isn't mistaken for parity.

## 4 · LOW (note, no action) — two small couplings the leg introduced
- `CpapDsp._synthEdfSet` was a dsp self-test helper; it is now **load-bearing** for the generic-emit gate's
  `providers.cpap` AND the Phase-9 floor. Keep its decoded-set shape stable — a change now ripples into two
  gates (consistent with `ECGDSP.genSynthetic` / `SYNTH.renderPPG`, which are similarly load-bearing).
- **Stale comment:** `tests/dex-tests.js` self-gate group (~L1669) still reads *"CPAPDex is not yet built →
  pending, not a failure"* — outdated (CPAPDex IS built; the `selfGateDesat` source-mirror assert is live and
  green). Tidy the comment (no logic change).

---

## Done when (whole brief)
- §1 a content/reference equivalence gate exists for CPAPDex (golden-export OR binary-input variant), wired
  into BOTH runners, green; a deliberate export-shape change must require regenerating the golden/fixture.
- §2 a `readEDF → compute()` floor case exists (or §1(b) covers it).
- §3 the `opts`-drop is either fixed (when live routing lands) or explicitly recorded as a known divergence.
- §4 the stale self-gate comment is tidied.
- Gates stay green: `Dex-Test-Suite.html` all-green · `verify-provenance.html` GATE A/B clean. Most items are
  test-only (no re-bundle); §3's `cpapBuildExport(night, opts)` change WOULD touch a bundled module → re-bundle
  CPAPDex + update `BUILD-MANIFEST.json` per the ritual.

### Priority summary
- **MEDIUM (⚠ highest):** §1 (no content/reference gate — the parity check pins paths, not output).
- **LOW:** §2 (readEDF→compute seam ungated end-to-end), §3 (compute() drops opts — latent, folds into -I §2).
- **LOW / note:** §4 (load-bearing `_synthEdfSet`; stale self-gate comment).
