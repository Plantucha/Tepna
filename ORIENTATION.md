<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** REFERENCE (living orientation map) · **last-verified:** 2026-06-30 · **Audience:** a new AI coder or code auditor, first 5 minutes

# Tepna Dex Suite — Orientation (start here)

A fleet of **single-signal physiological analyzers** ("Dexes") that each run **standalone, 100% in the
browser, fully offline** (no network, no CDN, system fonts only), plus a shared event bus and a fusion
layer that combine their outputs. The product brand is **Tepna**; the event-bus codename **Ganglior**
is FROZEN (never rename it). Author/licence: Michal Planicka · Apache-2.0.

> **This file is a MAP, not a description.** It points to where each fact actually lives — it does NOT
> copy metric names, variables, or function signatures (those drift; see *Maintaining this file* at the
> bottom). For the rules you must obey, **`CLAUDE.md` wins on every conflict** — read it first.

---

## The 60-second mental model

One signal flows through four layers, downhill only — **UI → DSP → INGEST → CORE**:

```
vendor file ─▶ [INGEST: detect + parse vendor format] ─▶ SignalFrame ─▶ [DSP: canonical → metrics] ─▶ [UI / export]
               (adapters/*.js, registered by signal)      (typed,        (one signal, no vendor logic)   (render + the
                                                            clock-normed)                                  ganglior.node-export)
```

- A **node** (one Dex) analyzes exactly one signal and never imports another node. Nodes converge ONLY
  through the **`ganglior.node-export`** JSON contract on the **Ganglior** bus.
- The **Integrator** reads those exports and fuses them (HRV consensus, apnea/PB corroboration, …). It
  is a *consumer that sits on top* — delete it and every node still works.
- **DSP/INGEST never touch the DOM.** A signal can come from many vendors; one **adapter** normalizes
  one vendor format → one **`SignalFrame`**; DSP only ever sees a `SignalFrame`. New vendor = one new
  adapter file, not a node edit.

The moat is the offline single-file build: every app is `<App>.src.html` + external `*.js`, bundled to
a standalone `<App>.html`. **Edit the `.js` + `.src.html`, never the bundled `.html`; re-bundle after.**

---

## The Dex roster (the one list worth memorizing)

| Dex | Signal | Typical input (vendor) | Computes | Core file |
|---|---|---|---|---|
| **OxyDex** | SpO₂ / oximetry | O2Ring / Wellue CSV | ODI, desaturation/hypoxic burden, periodic-breathing proxy | `oxydex-dsp.js` |
| **PulseDex** | raw RR intervals | Polar H10 `*_RR.txt` (Coospo/Wahoo too) | time/freq HRV from RR | `pulsedex-dsp.js` |
| **HRVDex** | HRV **summaries** | Welltory-style summary CSV | HRV trends + Baevsky SI/CSI (unit-guarded) | `hrvdex-dsp.js` |
| **ECGDex** | raw ECG waveform | Polar H10 `*_ECG.txt` (~130 Hz) | R-peak detection → NN → HRV, CVHR, QTc | `ecgdex-dsp.js` |
| **PpgDex** | raw PPG (optical) | Polar Verity Sense `*_PPG.txt` (176 Hz) | optical beat detection → self-PPI → HRV, posture | `ppgdex-dsp.js` |
| **GlucoDex** | CGM glucose | Abbott Lingo / Libre CSV | TIR, variability, nocturnal hypo, dawn surge | `glucodex-dsp.js` |
| **CPAPDex** | CPAP therapy (EDF) | ResMed AirSense `*.edf` set | AHI/CSL residual, periodic-breathing %, usage | `cpapdex-dsp.js` |
| **Integrator** | *(fusion)* | N× `ganglior.node-export` | cross-node consensus + corroborated findings | `integrator-dsp.js` |

Planned (not shipped): **EEGDex** (Muse EEG) and **SpiroDex** (flow-volume) introduce *new* signals →
they still need real new DSP. **UltrahumanDex / Coospo** are pure adapter wins (signals we already
analyze). New node names follow `LEXICON.md` (closed compound, capital-D, acronym stems all-caps).

Each node ships the same file pattern: `-dsp.js` (signal math, headless), `-render.js`, `-app.js`,
`-registry.js` (the metric truth source), usually `-cross.js` (cross-night envelope), plus any node-
specific aux (`oxydex-util.js`, `cpapdex-edf.js`, …) and `<App>.src.html`.

---

## The two orchestrators (consumers-on-top — NOT nodes)

The main human entry points. Like the Integrator, they **analyze nothing themselves** — they route files
to nodes and read results through the public `ganglior.node-export` seam. **Independence invariant:** no
node imports them; delete either and every node + the Integrator stay byte-identical.

- **Data Unifier** (`Data Unifier.html` · `data-unifier-app.js`) — the adapter registry with a drop-zone
  UI, and the **front-door for adding a vendor**. Drop a file (or a pile): it runs every adapter's
  `detect()`, routes each to its adapter, shows the normalized `SignalFrame` + `usable`/`reason`, and can
  emit a `ganglior.node-export`. A new vendor for an existing signal = **one new `adapters/*.js`**, nothing
  else.
- **OverDex** (`OverDex.html` · `overdex-walk.js` · `overdex-app.js`) — the capstone: **one drop, one fused
  result.** Point it at a nested **folder** of mixed exports from any device; `overdex-walk.js` walks the
  tree, routes every file via the *same* `SignalAdapters.route()` engine (not a fork), runs the right node's
  headless `compute()` via `signal-orchestrate.js` — or passes an already-exported `*_ganglior.json` straight
  through — then fuses everything via the Integrator. Unknown files are set aside (never guessed); ambiguous
  routes are confirmed by the user.

Both are **unbundled** (loose `<script src>` + a plain `.html`), so they touch neither gate. The router
(`SignalAdapters.route`) and the orchestrator (`signal-orchestrate.js`) are **shared single modules** — fix
a routing bug once and both tools inherit it.

---

## The shared spine

- **Ganglior bus** — the `ganglior.node-export` schema (events `{ t, impulse, node, conf, meta }`,
  `recording.startEpochMs` = floating `t0Ms`). FROZEN name + the input `fascia` alias. Vocabulary →
  `EVENT-LEXICON.md`.
- **Adapter layer (CORE)** — `signal-frame.js` (the `SignalFrame` type + `validateFrame`),
  `signal-spec.js` (signal-type registry: rr/ecg/spo2/cgm/ppg/hrv/cpap/…), `signal-adapters.js`
  (`registerAdapter` / `detect` / `route`), and `adapters/*.js` (one file per vendor format —
  `polar-rr`, `coospo-rr`, `wahoo-rr`, `polar-h10-ecg`, `polar-sense-ppg`, `libre-cgm`, `oxydex-spo2`,
  `welltory-summary`). `signal-orchestrate.js` drives a frame through a node's headless `compute()`.
- **Kernel** — `kernel-constants.js` → `DexKernel.HASH` (content hash of shared physiology constants,
  stamped into exports to catch cross-deployment drift). Loaded first everywhere.
- **Evidence badges** — `metric-registry.js` (injects badge CSS; `BADGE_CSS`) + `dex-badges.css`
  (byte-faithful mirror for static docs). The 5-level ladder lives ONCE; per-metric grade lives in each
  `*-registry.js`.
- **Orchestrators** — the two consumers-on-top (**Data Unifier**, **OverDex**) have their own section
  above; they are not nodes.
- **Research tools** — `*-analysis.html` (the live tool behind each paper in `papers/`), `cohort-*`,
  `synth-gen.js`. Architecture wiring diagrams → `wiring/`.

---

## The two gates (run these; treat a red as a blocker)

1. **Behavior — `Dex-Test-Suite.html`** (CI mirror: `node tests/run-tests.mjs`). One assertion library
   (`tests/dex-tests.js`), real modules loaded, plus browser render-coverage. Render-coverage is
   **on-demand** (lazy): a bare open paints only the headless floor (amber pill — **not** a pass); open
   **`Dex-Test-Suite.html?full`** (or click **▶**) to boot the rigs, then the `#summary` pill must read
   **all green** after the group count stops climbing (~30–50 s). Run after ANY `*-dsp.js` /
   `*-cross.js` / `*-app.js` change.
2. **Provenance — `verify-provenance.html`** (CI mirror: `node tests/verify-manifest.mjs`). PURE-STATIC,
   content-addressed. **GATE A**: each bundle's `manifestHash` matches `BUILD-MANIFEST.json`. **GATE B**:
   each `FIXTURE-PROVENANCE.json` fixture is a known-answer triple `hash(input) + manifestHash →
   hash(output)`. `buildHash` is retired (no gate reads it). Read `window.__provenanceOK`.

---

## Where the truth lives — DON'T copy it, point to it

| If you need… | Look at | Kept honest by |
|---|---|---|
| a metric's label / unit / good-direction / **evidence grade** | that node's `*-registry.js` | `cohesion-badges` test (registry ≡ `dex-badges.css` ≡ reference guide) |
| a function's contract / return shape | `tests/dex-tests.js` | the test IS the contract; both runners use it |
| the rules, gates, invariants, re-bundle ritual | **`CLAUDE.md`** | wins on every conflict |
| the time model | `CLAUDE.md` "Clock Contract" + each `*-dsp.js` `parseTimestamp` (mirrored, intentionally) | round-trip tests |
| the event / impulse vocabulary | `EVENT-LEXICON.md` | event-lexicon test group |
| the canonical signal shape + signal types | `signal-frame.js` / `signal-spec.js` | `validateFrame` + property/round-trip tests |
| provenance (code identity + fixtures) | `BUILD-MANIFEST.json` / `FIXTURE-PROVENANCE.json` / `manifest-gate.js` | GATE A / GATE B + the equiv gate |
| status of every brief / what's done | `DOCS-INDEX.md` | the dashboard; kept in sync on each status flip |
| the layered architecture model | `ARCHITECTURE-PRINCIPLES.md` | — |
| naming a new node | `LEXICON.md` | — |
| how raw signals were captured | `CLAUDE.md` "Capture provenance" + `how-to-collect/` | — |
| deploy / what to upload | `SITE-DEPLOY-AND-LAYOUT.md` | — |
| licensing / attribution | `licensing/LICENSING-BRIEF.md` | SPDX-header + cohesion checks |

---

## Rules you cannot break (full text in `CLAUDE.md`)

FROZEN names (`Ganglior`, `fascia`, `ganglior.node-export`, `DexKernel`) · the **Clock Contract**
(floating wall-clock `tMs`, read back via `getUTC*`, missing stamp → `null` never `now()`) · **metric
is the default unit system** (store/compute in SI; imperial is a display-only switch) · **100 % local**
(no network/CDN/web-font) · **dependency direction downhill** (nodes never import each other) · **every
surfaced number carries an evidence badge** · **edit `.js`/`.src.html`, never the bundled `.html`** ·
**SPDX header on every authored file**.

---

## Maintaining this file (so it can't rot)

This map survives only because it documents **slow-changing structure** and **points to** the fast-
changing truth instead of copying it. Keep it that way:
- **Never** list variables, metric values, or function signatures here — those live in source +
  `*-registry.js` + `tests/dex-tests.js`, each gated. A catalog here would silently drift and become a
  liability (the project's whole philosophy is single-source-of-truth + tests catch drift).
- The **one volatile list** is the Dex roster table, and it is now **gate-backed**: the `tests/dex-tests.js`
  group *“Orientation map — roster covers the shipped fleet”* asserts every committed `BUILD-MANIFEST.json`
  bundle is named here, so shipping a node and forgetting the map turns the suite RED. Update the roster +
  bump `last-verified` when a node ships; that's the only upkeep this file needs.
