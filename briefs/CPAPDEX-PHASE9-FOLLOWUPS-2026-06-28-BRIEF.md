<!--
  CPAPDEX-PHASE9-FOLLOWUPS-2026-06-28-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-06-28 · **Created:** 2026-06-28 · **Follows:** `SIGNAL-ADAPTER-PHASE9-REMAINING-NODES-2026-06-25-BRIEF.md` (the CPAPDex leg — node 4/4, executed 2026-06-28) · **Spawned:** `CPAPDEX-PHASE9-FOLLOWUPS-II-2026-06-28-BRIEF.md` (the gate-coverage re-audit residue), `CPAPDEX-PHASE9-FOLLOWUPS-III-2026-06-28-BRIEF.md` (execution residue: multi-night-wrapper fixture-coverage gap) · **Relates:** `GENERIC-EMIT-GATE-FOLLOWUPS-2026-06-28-BRIEF.md` §1 (the frame-shape fork this resolved), `CPAPDEX-BUILD-BRIEF.md` §6 (fusion/export)

# CPAPDex Phase-9 — follow-ups (residue from executing the node-4/4 migration)

> **✅ Executed 2026-06-28.** **§1** — VERIFIED all three fixtures' CONTENT is current-code-reproducible by re-running
> the loose CPAPDex modules (`cpapdex-edf/dsp/fusion.js`, the SAME source bundled into `CPAPDex.html` @ manifestHash
> `75d4c6dee9b6`) on the committed AirSense EDF sets. The two SINGLE-NIGHT exports (`cpapdex-2026-06-12.node-export.json`,
> 2 sessions; `cpapdex-2026-06-16.json`, 1 session) reproduced **BYTE-IDENTICAL** (0 non-volatile diffs) → now
> **code-gated** in `FIXTURE-PROVENANCE.json` (`{bundle:'CPAPDex.html', manifestHash:'75d4c6dee9b6'}`). Per the house
> EXPORT-INERT precedent (byte-identical ⇒ do NOT rewrite the file, only record the manifestHash) the files are left
> as-is — their stale `buildHash` (`c22f274d8cea`) is now inert because GATE B's code-gated path ignores the stamped
> buildHash — which ALSO preserves `uploads/integrator_fusion_2026-06-16.json`'s historical `inputs[]` fingerprint of
> the 06-16 file. **⚠ DEVIATION (verify-don't-trust):** the brief's premise that all three are reproducible is WRONG
> for `cpapdex-multi17-2026-06-16.json` — it is a 17-night multi-night export whose source EDFs (`20260531_204645_*.edf`
> onward) were **never committed** (only the 06-12 / 06-13 / 06-16 sets are = 2 nights), and `exportNight`'s multi-night
> wrapper needs **≥3 nights** while the committed inputs yield only 2, so it cannot be faithfully regenerated.
> Following the `OxyDex_2026-06-17_2042` precedent it was **RETIRED** to `docs-archive/retired-fixtures/` (+ a
> `_retired` entry + README rationale) rather than dishonestly code-gated. **§2** (no live-host EDF routing — owner-
> gated), **§3** (`cross.js` self-describing evidence — fleet-wide), **§4** (Node-CI) left deferred/standing per the
> brief. **Gates:** test/fixture-only, **NO re-bundle** (bundle + `BUILD-MANIFEST.json` untouched) → `verify-provenance`
> GATE A 8/8 unchanged, GATE B code-gated green; the §1/§2 logic from -II verified Node-parity green (golden + readEDF→
> compute byte-identical). Residue (the retired multi-night wrapper now has no fixture) → `CPAPDEX-PHASE9-FOLLOWUPS-III`.

> **Read `CLAUDE.md` first** (the two gates, the Clock Contract, the re-bundle ritual). This brief is the
> residue surfaced while executing the **CPAPDex Phase-9 leg** of `SIGNAL-ADAPTER-PHASE9-REMAINING-NODES`.
> Nothing here blocks the node-4/4 DONE stamp (both gates were green at execution: `Dex-Test-Suite.html`
> 1312/81 all-green, `verify-provenance.html` GATE A 8/8 + 0 red). Everything below is fixture-/host-/doc-
> layer or a deliberately-deferred design choice.

## 0 · What the CPAPDex leg shipped (context — verify, don't trust)

`cpapdex-dsp.js` gained `CPAPDex.compute(cpap SignalFrame | decoded EDF set | night) → ganglior.node-export`,
delegating to the SHARED `CpapFusion.cpapBuildExport` (additive — the app's `exportNight` is untouched →
byte-identical export). The **frame-shape fork** (GENERIC-EMIT-GATE-FOLLOWUPS-I §1) was resolved as the NEW
`signal-spec.js` `cpap` type (kind:samples, L/s) carrying the 25 Hz BRP FLOW waveform in `samples` + the
decoded `{BRP,PLD,SA2,EVE,CSL}` set(s) as a `frame.edfSets` SIDECAR (the ECG-companion pattern; no
`validateFrame` change). `signal-orchestrate.js` got `cpapHost`/`emitCpapNodeExport` + the dispatch/summary
cases + `_EMITTABLE.cpap`. Gated by `tests/dex-tests.js` (generic-gate `providers.cpap`/`NODE_OF.cpap`, a
Phase-9 floor case + a `compute() ≡ cpapBuildExport` parity assert, host-emit-allowlist). `CPAPDex.html`
re-bundled (manifestHash `73d870b6ccfc`→`75d4c6dee9b6`, buildHash `2702e925dfd1` UNCHANGED).

---

## 1 · LOW (fixtures) — three legacy CPAPDex export fixtures stamp a STALE buildHash, not code-gated

`uploads/cpapdex-2026-06-12.node-export.json`, `uploads/cpapdex-2026-06-16.json`, and
`uploads/cpapdex-multi17-2026-06-16.json` each stamp `schema.provenance.buildHash` **`c22f274d8cea`** — an
OLD build (current `CPAPDex.html` buildHash is `2702e925dfd1`). They are NOT in `FIXTURE-PROVENANCE.json`, so
`verify-provenance.html` GATE B falls them through to the COARSE `buildHash` chain → on a host that can
**directory-list** `uploads/`, each would read a red `stale build — expected 2702e925dfd1`. It did NOT red at
execution because the sandbox/preview can't list the dir, so the fixture audit used the static
`sidecar.concat(legacy)` fallback (which doesn't include these). **This is a PRE-EXISTING drift** (left by an
earlier node re-bundle), NOT introduced by the Phase-9 leg — the leg did not touch the export logic
(`cpapBuildExport`/`cpapEvents`/`buildSessionFromEdf`), so the fixtures' CONTENT is still current-code-
reproducible; only the provenance stamp is stale.
- **Do (deliberate fixture-regen pass, NO code change):** re-run the CPAPDex app on the committed AirSense
  EDF set + re-export (NEVER hand-edit — Step G #6), then RECORD each in `FIXTURE-PROVENANCE.json`
  → `{ bundle:'CPAPDex.html', manifestHash:'<current>' }` so GATE B code-gates them (the teeth `buildHash`
  lacks). Once recorded, they also appear in `verify-provenance.html`'s static fallback enumeration → green
  by construction. (Left out of the migration pass to keep it byte-identical + low-risk: registering a
  fixture as code-gated asserts reproducibility, and the leg did not re-run the app to confirm byte equality.)

## 2 · MEDIUM (design — deferred deliberately) — CPAPDex has NO live-host routing path (binary EDF vs readAsText)

CPAPDex is **intentionally absent** from `dex-coload.js` and the live hosts (`Data Unifier.html` /
`OverDex.html`). The host ingest boundary is `FileReader.readAsText` (`data-unifier-app.js`), which cannot
round-trip a BINARY multi-file EDF set — so a registered text adapter would receive mangled bytes and have to
fabricate (the §1 honesty trap). EDF ingest therefore stays the CPAPDex APP's job (it reads ArrayBuffers).
The emit path (`emitCpapNodeExport`) is exercised only in the TEST realms (where `cpapdex-dsp.js`+`-fusion.js`
are co-loaded); the generic-emit gate's DRIVER-2 (`canEmit`-bound) still forces a schema-valid export, so the
shape can't drift. **Consequence:** a CPAP `.edf` dropped into the Data Unifier / OverDex today will NOT route
to CPAPDex (it routes via the CPAPDex app only).
- **Do (only if cross-node CPAP-in-Unifier is wanted — owner-gated):** add a BINARY read path at the host
  boundary (`readAsArrayBuffer` for `.edf`, alongside the existing `readAsText`) + a binary-aware adapter
  contract (`parse(buf, ctx)` with the multi-file set paired by filename stamp via `pairCompanions`, mirroring
  the ECG/PPG companion ingest but for ArrayBuffers), then register `adapters/resmed-edf.js` and add it +
  `cpapdex-dsp.js`/`-fusion.js`/`-edf.js` to `dex-coload.js` and all four hosts. This is a real ingest-layer
  change (not a node-internal one) and should be its own deliberate pass, not folded into a node migration.

## 3 · LOW (cohesion, fleet-wide — NOT CPAPDex-specific) — cross.js crossnight evidence still not self-describing

`CPAPDEX-BUILD-BRIEF.md` §6 + the codegen handoff note that new emitters SHOULD write self-describing
`evidence` on each crossnight-envelope metric so the Integrator can badge CPAPDex longitudinal trends.
`cpapdex-cross.js` (like the other nodes' `*-cross.js`) does NOT yet — this is the SAME separately-scoped,
fleet-wide gap the ECGDex/PpgDex/GlucoDex legs each carried forward, not a CPAPDex regression. Track with the
existing cross.js-evidence debt; do not open a CPAPDex-only tracker.

## 4 · (carried, not new) Node-CI standing debt
`node tests/run-tests.mjs` is not run in this environment (no Node host); the CPAPDex co-load + env wiring
were added to `run-tests.mjs` for parity, but verification was via the same-origin `Dex-Test-Suite.html`
(the substitute gate). Same standing debt as every prior leg — co-tracked at
`GENERIC-EMIT-GATE-FOLLOWUPS-II §1`; do not open a new tracker.

---

### Priority summary
- **LOW / fixtures:** §1 (three legacy CPAPDex fixtures stale-stamped + not code-gated — a deliberate
  regen+register pass; pre-existing, sandbox-invisible).
- **MEDIUM / design (deferred):** §2 (no live-host EDF routing — needs a binary read path; owner-gated).
- **LOW / cohesion + CI:** §3 (cross.js self-describing evidence — fleet-wide), §4 (Node-CI — carried).
