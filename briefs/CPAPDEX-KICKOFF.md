<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** DONE — 2026-06-28 · **Created:** (undated — predates the dated-brief convention) · All steps executed: the node is built + bundled and the Phase-9 emit migration (node 4/4) landed; both gates green (`Dex-Test-Suite.html` all-green, `verify-provenance.html` GATE A 8/8). Phase-9 leg + residue: `SIGNAL-ADAPTER-PHASE9-REMAINING-NODES-2026-06-25-BRIEF.md` + `CPAPDEX-PHASE9-FOLLOWUPS-2026-06-28-BRIEF.md`.

# CPAPDex — Handoff Kickoff Script

> **Purpose:** the exact, ordered sequence to hand CPAPDex to a fresh AI coder (Claude Code
> preferred). Copy the **bold prompt** at each step verbatim; do the **Verify** before moving on.
> Do not skip the ordering — each step depends on the gate of the one before it.

---

## Step 0 — Orient (read-only, no code yet)

> **"Read `CLAUDE.md` in full, then `CPAPDEX-CODEGEN-HANDOFF.md`, then `CPAPDEX-BUILD-BRIEF.md`.
> Then read the two working scaffolds `cpapdex-edf.js` and `cpapdex-dsp.js` and run their
> self-tests (`cpapdex-edf-selftest.html`, or `node cpapdex-edf.js --selftest` and
> `node cpapdex-dsp.js --selftest`). Confirm back to me: (a) the Clock Contract in one sentence,
> (b) the node file split, (c) what the two scaffolds already do and the three things they leave
> to you. Do not write any code yet."**

**Verify:** it parrots back floating-`tMs`/`getUTC*`, the `*-dsp/render/app.js`+`.src.html`→bundle
split, and names EDF✓/DSP-metrics✓ done vs self-gate/fusion/cohesion todo. If it proposes a Unix-
epoch time model or a single `cpapdex-analysis.js`, STOP and re-point it at `CLAUDE.md`.

## Step 1 — Real EDF round-trip (prove the reader on actual files)

> **"Using the existing `cpapdex-edf.js` (do not rewrite it), load the real
> `uploads/2026061*_*.edf` set in a small harness. Assert: sample counts = spr×records per signal,
> physical scaling sane (pressure in cmH₂O, leak in L/min), EVE/CSL annotations decode to classed
> events with absolute `tMs`, and the header clock round-trips (first/last sample wall-clock ==
> the file's start time read with `getUTC*`). Report any header quirks (numRecords=-1, truncated
> tail). Fix bugs in `cpapdex-edf.js` only if a real file breaks it — keep the self-test green."**

**Verify:** real BRP/PLD/SA2/EVE/CSL files decode; the clock round-trip matches the file exactly.

## Step 2 — DSP on real data + the parts the scaffold left open

> **"Extend `cpapdex-dsp.js` (keep its self-test green; add to it). Wire `buildSession`/`buildNight`
> to the real decoded signals (PLD pressure/leak, SA2 pulse/SpO₂, EVE events). Then add, per
> `CPAPDEX-BUILD-BRIEF.md` §3–§4: flow-derived breath detection from 25 Hz BRP, CSL periodic-
> breathing %, EPR delta + CPAP/APAP detection, the SA2 oximetry QC lane (ODI/T90/nadir), and the
> **oximeter self-gate** (§4.4) mirroring `OXIMETER-SELFGATE-AND-CONSEQUENCE-COROBORATION.md`
> Part A verbatim — gate desats before ODI. Mirror `parseTimestamp` locally; do not extract a
> shared util."**

**Verify:** AHI/leak/pressure match the device summary on the real night; a deliberately-injected
perfusion-collapse desat is flagged `artifact` and excluded from ODI.

## Step 3 — Registry + render (cohesion-native from birth)

> **"Create `cpapdex-registry.js` cloning `oxydex-registry.js`: every metric from
> `codegen/manifests/cpapdex.manifest.json` as `{label,unit,goodDirection,depth,evidence,cite}`,
> with the `evBadge`/`badgeForLabel`/`depthForLabel` exports and a label-alias map. Then build
> `cpapdex-render.js` cloning `oxydex-render.js`/`oxydex-fusion.js` for the KPI grid + full metrics
> table, with evidence badges in the bottom-right card corner / metric-name cell per
> `SYSTEM-COHESION-BRIEF.md` + `Visual-Language-Spec.html`. Mount `MetricRegistry.mountDepthSelector`.
> Evidence tiers: device-scored EVE = `measured`, flow-detected = `validated/emerging`, composites
> = `experimental`."**

**Verify:** badges + depth selector render; classes match the five shipped nodes exactly (diff a
PpgDex card against a CPAPDex card — same `.ev`/pill/`fmt-m` markup).

## Step 4 — Fusion: events + export

> **"Create `cpapdex-fusion.js` cloning `oxydex-fusion.js`. Emit `ganglior_events`
> (apnea/hypopnea/periodic_breathing/desat/large_leak) with `conf`=device severity, `sqi`=leak
> quality, `node:"CPAPDex"`, event `t`="HH:MM:SS" wall-clock + absolute floating `tMs`. Export
> `schema.name:"ganglior.node-export"`, `recording.startEpochMs`=night `t0Ms`, sessions[]+off-mask
> gaps. Write self-describing `evidence` on each crossnight-envelope metric so the Integrator can
> badge CPAPDex trends. Keep the fusion window `LEAD=15/TRAIL=60` IDENTICAL to OxyDex — change only
> source-precedence (device-scored EVE = top apnea tier), not the numbers."**

**Verify:** export validates against the Export Contract (`CLAUDE.md` §6); load it in
`verify-provenance.html` after bundling.

## Step 5 — Assemble + bundle

> **"Create `CPAPDex.src.html` (clone `OxyDex.src.html`) with load order: `ganglior-provenance.js`
> → `metric-registry.js` → `cpapdex-registry.js` → `cpapdex-edf.js` → `cpapdex-dsp.js` →
> `cpapdex-render.js` → `cpapdex-app.js`, plus the `<template id="__bundler_thumbnail">`. Wire
> `cpapdex-app.js` (file input → readEDF → buildNight → render). Bundle to `CPAPDex.html` via the
> inliner. Never edit the bundled file; re-bundle after every change. System-font stacks only, no CDN."**

**Verify:** `CPAPDex.html` opens, loads the real night, shows two stitched sessions + AHI vs device.

## Step 6 — Gates (the definition of done)

> **"Fold the scaffold self-tests + new assertions (EDF decode, clock round-trip, self-gate, AHI
> math, session/gap) into `tests/dex-tests.js` so BOTH `node tests/run-tests.mjs` and
> `Dex-Test-Suite.html` cover CPAPDex, and add a render-coverage entry driving the CPAPDex bundle in
> an iframe. Add the synthetic CPAP night + the two failure-injection fixtures
> (`CPAPDEX-BUILD-BRIEF.md` §8) to `synth-gen` / `SYNTHETIC-CORPUS-BRIEF.md`. Then: open
> `Dex-Test-Suite.html` — must be all-green; open `verify-provenance.html` — zero red (re-stamp the
> CPAPDex export fixture's `buildHash` after the final bundle). Only then call done."**

**Verify:** `Dex-Test-Suite.html` all-green (count rises from 272), `verify-provenance.html` zero red.

---

## Guardrails to repeat if it drifts

- **Time:** floating `tMs` via `Date.UTC(...)`, read with `getUTC*`. Missing stamp ⇒ `null`, never `new Date()`/now().
- **Build:** edit `cpapdex-*.js` + `CPAPDex.src.html`; never the bundled `.html`; re-bundle every change.
- **No** `@font-face`/CDN/woff2. **No** shared `parseTimestamp` util (mirror locally).
- **Don't** touch the five shipped nodes' cohesion work — it's done and green.
- **Scaffolds are load-bearing:** extend `cpapdex-edf.js`/`cpapdex-dsp.js`, keep their self-tests green; don't rewrite them from the codegen output (the codegen assumes Unix epoch — wrong).

## One-line kickoff (if you want a single opening message)

> **"Build CPAPDex. Start at Step 0 of `CPAPDEX-KICKOFF.md` and stop for my confirmation after each
> step's Verify. The Clock Contract in `CLAUDE.md` and the locked spec in `CPAPDEX-BUILD-BRIEF.md`
> are non-negotiable; `cpapdex-edf.js` and `cpapdex-dsp.js` are working scaffolds to extend, not
> replace."**
