<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Tepna — Architecture Principles

> **For any coder (human or AI) working on this system, and for whoever eventually does the
> layer-separation pass.** Read `CLAUDE.md` first (it wins on any conflict — especially the Clock
> Contract and the two gates). This document states the *target architecture* and the *rules* that
> keep Tepna scalable. It is a constitution, not a task list: adopt it **forward** (new code is
> born compliant) and **migrate old code opportunistically** — never in one risky sweep.

---

## 0. What Tepna is (frame the decisions)

Tepna is a **browser-native, 100%-local physiological analysis instrument framework** — a fleet of
single-signal analyzers (the -Dexes) plus a shared event bus (Ganglior) and a fusion layer
(Integrator). Its defining advantages, in priority order:

1. **Instant reproducibility** — a bundled `Foo.html` is a frozen, hash-verifiable instrument. Open it
   in 2026 or 2036, online or on a plane, and it computes the same numbers.
2. **Portability** — one file, no install, no server, no network. Runs from `file://`.
3. **Auditability** — provenance stamps + the test suite mean every number traces to a reproducible
   build and a known contract.

**Every architectural decision must protect these three.** A change that improves "code cleanliness"
but weakens reproducibility/portability/auditability is the wrong change. This is why the answer to
"the system is getting serious, should we move to a backend / microservices / Python?" is **no** —
that trades away advantage #1 and #2 to solve a problem we don't have. The real scaling limit is
**drift**, and the fix for drift is **tighter contracts inside the architecture we already have**, not
more infrastructure.

---

## 1. The three layers (one job each)

The single most important rule in this document. Every file belongs to exactly one layer, and each
layer has exactly one responsibility. The boundaries — not the folder names — are what matter.

### CORE — shared, stable, frozen-ish truth
The constitution every node obeys. Today: `metric-registry.js`, the kernel
(`DexKernel`/`kernel-constants`), `crossnight-envelope.js`, the Clock Contract, the Ganglior
export schema.

- **Rule: nothing device-specific ever lives in CORE.** No "oxygen" knowledge, no "glucose"
  knowledge. If a constant or function is meaningful to only one node, it does not belong here.
- CORE is **stable by default**. Changing it is a deliberate, contract-aware act (see §3), because
  every node depends on it. New CORE capability is added as **new** surface (new field, new method),
  not by mutating existing surface.
- Test: *"Would this code be identical regardless of which signal the node measures?"* If yes → CORE.

### DSP — one node's signal logic, and nothing else
Pure domain math: signal transforms, feature extraction, metric computation. `oxydex-dsp.js` knows
oxygen; `hrvdex-dsp.js` knows HRV; `cpapdex-dsp.js` will know airflow/pressure.

- **Rule: no UI, no rendering, no DOM, no state persistence, no `localStorage`.** DSP takes parsed
  input and returns metrics/objects. It is the part you could, in principle, run headless in Node
  (and the test suite essentially does).
- DSP is where the **domain expertise** concentrates. It is allowed to be complex — but it is *only*
  complex about its one signal.
- `parseTimestamp` is duplicated into each DSP **by design** (Clock Contract) — that is the one
  sanctioned duplication; do not "fix" it into a shared util.
- **DSP purity pays off directly: a pure DSP runs headless anywhere** — in Node (the test suite), and
  in a **Web Worker** off the main thread. The proven shim (`self.window = self` before
  `importScripts('kernel-constants.js','clock.js',<dsp>.js)` + feature-detect) is a reusable pattern —
  forward-adopt it for any heavy batch/cohort/folder tool (CONTRIBUTING.md §5.5; TRIO-METHODS-REUSE
  §Do 1). If a DSP had UI/DOM/storage in it, none of this would work — that is the point of the rule.
- Test: *"Does this compute a number from a signal?"* → DSP. *"Does this decide how a number looks?"*
  → not DSP.

### UI — rendering and input only
`*-render.js`, `*-app.js`, `Foo.src.html`. Visualization, file input, calling DSP, wiring controls.

- **Rule: no signal logic in UI.** A render file must never recompute a metric, re-threshold a value,
  or re-derive physiology. It asks DSP for the number and the registry for how to label/badge it.
- UI owns: layout, charts, the evidence-badge spans, the depth selector, export buttons, persistence
  of *view* state (which tier, scroll position).
- Test: *"If I deleted this line, would a NUMBER change, or only its APPEARANCE?"* Appearance → UI.
  Number → it's misplaced, move it to DSP.

> **Why this matters concretely.** Today a desaturation rule could exist in OxyDex's render code and
> get subtly re-implemented in CPAPDex's render code → two truths. With the boundary rule, that rule
> can only live in DSP (or be a shared CORE definition), so there is exactly one place it can drift
> from — and the test suite watches that one place.

---

## 2. The dependency direction (acyclic, downhill)

```
        ┌──────────────────────────────────────────┐
        │                 CORE                      │   ← depends on nothing
        │  kernel · metric-registry · envelope ·    │
        │  clock contract · ganglior export schema  │
        └──────────────────────────────────────────┘
                    ▲                    ▲
                    │ uses               │ uses
        ┌───────────────────┐   ┌────────────────────┐
        │   DSP (per node)   │   │  Integrator fusion │  ← consumes node EXPORTS,
        │  pure signal math  │   │  (cross-node)      │     never node internals
        └───────────────────┘   └────────────────────┘
                    ▲
                    │ calls
        ┌───────────────────┐
        │   UI (per node)    │   ← depends on its DSP + CORE; never on another node
        └───────────────────┘
```

- **Dependencies point downhill only.** UI → DSP → CORE. CORE never imports a node. DSP never imports
  UI. No cycles, ever.
- **Nodes never import each other.** A -Dex is independent and standalone by design (a user may own
  only one device). Cross-node interaction happens **exclusively through the Ganglior export
  contract**, consumed by the Integrator — never by reaching into another node's functions.
- The Integrator depends on the **export schema** (CORE-level contract), not on any node's DSP.

---

## 3. Contracts are the real product (kernel hardening)

The system's durability comes from **enforced contracts**, not from tidy code. Three contracts:

1. **The metric contract.** Every metric a node emits has a single definition — id, label, unit,
   `goodDirection`, `depth`, `evidence`, `cite` — in that node's registry, matched to its envelope
   `*_DEFS`. The registry/envelope are the *one* place a metric is described; render and export read
   from it, never redefine it.
2. **The export contract.** `ganglior.node-export` shape (`schema.name`, `recording.startEpochMs` =
   floating `t0Ms`, `ganglior_events[]` with wall-clock `t` + absolute `tMs`). This is the cross-node
   currency. Consumers must tolerate legacy `t`-only exports.
3. **The CORE API contract.** Kernel scoring, envelope definitions, registry methods. These do not
   silently evolve.

**The golden rule of changing a contract** (already in `CLAUDE.md`, restated because it is central):
> Keep back-compat. Add new params **LAST and optional**; expose new data via a **NEW** field/method.
> Do not edit a shared assertion to match changed behavior — either preserve the old shape, or update
> `tests/dex-tests.js` *deliberately*, knowing Node CI uses the same file.

**`Dex-Test-Suite.html` is the guardian of physiological truth.** It is not a regression nicety; it is
the mechanism that makes the contracts real. The shared assertions in `tests/dex-tests.js` ARE the
public contract — when behavior and assertion disagree, the assertion is right until a human
deliberately changes it. (Example already in place: the evidence ladder's `measured` level is
contract-locked there, so no node can quietly drop or reorder it.)

---

## 4. The epistemic principle (honesty is architectural)

Tepna's credibility rests on never presenting a guess as a measurement. This is encoded, not just
cultural:

- **The evidence ladder** (`measured ◉ → validated ● → emerging ◐ → experimental ○ → heuristic ◌`) is
  attached to *every* metric. A raw sensor reading and a population projection must never look alike.
- **A missing value is `null`, never fabricated** (Clock Contract: a missing timestamp is `null`,
  never `now()`). Absence must stay visible.
- **Confidence ≠ quality.** An event's `conf` (severity/likelihood) and its `sqi` (signal quality) are
  separate axes; fusion attenuates via `effConf = conf × (sqi ?? 1)`. Never collapse them.
- **Capability before consensus.** When sources disagree, you do not count devices — you filter to
  sensors that *can* observe the signal, check internal plausibility, and look for the obligate
  physiological consequence. (See the self-gate / consequence-corroboration brief.)

A new node or metric that cannot honestly place itself on the evidence ladder is a design smell —
resolve the honesty question before shipping the number.

---

## 5. Authority is per-signal, quality-gated (fusion principle)

There is **no single "best device."** Authority is assigned **per signal**, and a gold-standard source
**yields to a clean backup when its own quality gate trips**. Chest ECG owns HRV but is useless when
its battery dies; the wrist PPG is the fallback for HR but never for HRV magnitude under motion. The
Integrator encodes this matrix (see the CPAPDex brief §6). New nodes declare what they are
authoritative *for*, not that they are authoritative.

---

## 6. Reproducibility & provenance (don't break the thing that makes us special)

- **100% local. No network, no CDN, ever.** Fonts are system stacks. Assets are inlined at bundle
  time, not fetched.
- **Edit the inputs, never the bundle.** Edit `*-dsp.js` / `*-render.js` / `*.src.html`; rebuild with the
  **owned deterministic bundler** — `node tools/build.mjs --app <Name>` (or the shared `tools/build-core.js`
  via `tools/build.html` / an agent's run_script) — which emits PLAIN-INLINE bundles (`<script|style
  data-inline-src>` readable text, no gzip/UUID) and auto-restamps the ledgers. Never use the legacy platform
  inliner: a regressed `__bundler/manifest` bundle hashes to null and reds GATE A. The bundle's
  **`manifestHash`** — a deterministic projection of its inlined JS/CSS — is the
  instrument's executed-code fingerprint, and the sole code identity the gates check. (`buildHash` is
  RETIRED — dropped from `BUILD-MANIFEST.json` 2026-07-03; still stamped into exports as inert legacy
  metadata, but no gate reads it; do not reason about it.)
- **Two gates, every change** (`CLAUDE.md`): `Dex-Test-Suite.html` all-green after any DSP/app/bundle
  change; `verify-provenance.html` no red mismatch after any re-bundle. `manifestHash` is deterministic —
  it moves ONLY on a real JS/CSS code change (a re-build of identical source is byte-identical) — and
  `build.mjs` writes the GATE-A entry + re-stamps code-gated fixtures for you; regenerate a fixture's OUTPUT
  only when the change actually moved it (the equiv gate tells you). `node tools/build.mjs --check` is the
  CI drift guard: every committed bundle ≡ build(source).

---

## 7. When (and how) to do the layer-separation pass

This is the one larger refactor implied by §1. Guidance so it's done safely:

- **Do NOT run it during the cohesion rollout or the CPAPDex build.** Moving code while other briefs
  edit it guarantees conflicts. It is a *deliberate, standalone* pass.
- **Adopt forward first.** Build CPAPDex layer-clean from day one (its brief already separates
  `cpapdex-edf.js` / `-dsp.js` / `-render.js` / `-fusion.js`). New code costs nothing to do right.
- **Migrate old nodes opportunistically**, one node per pass, gating after each — never six at once.
  The goal state: each node is `<node>-dsp.js` (pure math) + `<node>-render.js` (pure UI) + a thin
  `<node>-app.js` (wiring/export), all over a CORE that holds zero device knowledge.
- **Success test for a migrated node:** you can run its DSP headless (Node) with no DOM, and its
  render file contains no number that isn't sourced from DSP or the registry.

---

## 8. Adding a new Dex — the pointer-checklist (EEGDex, SpiroDex, UltrahumanDex…)

Everything below is already specified in detail *somewhere*; this is the **ordered index of where**, so
a coder (usually an agent) can add a node by reading *little* rather than slurping the whole doc set. It
restates nothing — follow each pointer for the actual rules. Forward-first: a new node is born compliant.

1. **Name it** — `LEXICON.md §4` (closed compound, capital-D, acronym stems all-caps: `EEGDex`,
   `SpiroDex`). Frozen bus/schema names (`Ganglior`, `fascia` alias, `ganglior.node-export`) are NOT yours
   to touch (`CLAUDE.md`).
2. **Classify the signal** — new *vendor* for a signal we already compute = just a new **adapter**
   (`SIGNAL-ADAPTER-AND-FRONTIER` brief); genuinely new signal type (EEG, flow-volume) = new adapter **+
   real new DSP**. Register the type in `signal-spec.js`.
3. **Ingest → one `SignalFrame`** — write `adapters/<vendor>-*.js` (`SIGNAL-ADAPTER-AND-FRONTIER` Phase 0);
   honor the **Clock Contract** verbatim (`CLAUDE.md`) — mirror `parseTimestamp` into the DSP (the one
   sanctioned duplication, §1), floating `tMs`, `null` never `now()`, vendor formats by regex.
4. **DSP — the signal's math** (`<node>-dsp.js`, §1 rules: pure, headless-runnable, no UI/DOM/storage).
   Metric-canonical (SI; imperial only at the display boundary — `CLAUDE.md`).
5. **Metrics as data, ONCE** — author `codegen/manifests/<node>.manifest.json` and generate
   `<node>-registry.js` + reference guide via `codegen/dex-registry-gen.js` / `dex-gen.js` (the
   forward-first path — do NOT hand-write a registry for a new node; §3 metric contract). Every metric
   places itself on the **evidence ladder** (§4) — resolve the honesty question before shipping the number.
6. **Evidence badges on every surfaced number** — the COVERAGE MANDATE (`CLAUDE.md`); apps load
   `metric-registry.js`, never hardcode disc CSS (`dex-badges.css`).
7. **Export via the contract** — `ganglior.node-export` shape (§3); declare what the node is authoritative
   *for* (§5), not that it's authoritative. Cross-node interaction is export-only — nodes never import each
   other (§2). **Decide the export shape up front** — light (events-only) vs rich (clinical reload) builders,
   multi-carrier key, and which artifact `loadOwnExport` reloads: `docs/EXPORT-SHAPES.md` (per-node table +
   the rules a new node follows).
8. **UI** — `<node>-render.js` + `<node>-app.js` + `<Node>.src.html` (§1: no signal logic in UI; a number
   comes from DSP or the registry, never recomputed in render).
9. **Wire the gates** — add the node's `<NODE>_REGISTRY` + resolver + reference-guide text to `env` in BOTH
   runners (`run-tests.mjs` + `Dex-Test-Suite.html`) so `cohesion-badges` covers it; add a render-coverage
   rig + an `env.equiv` leg (`CLAUDE.md` gate sections). ≥1 dynamic equiv/golden leg per code-gated node.
   Add the node to the **`BORN_CLEAN` set** in `tests/dex-tests.js` — the `born-clean` group then enforces
   headless DSP (no DOM/localStorage) + `compute()` + every-metric-evidence-graded + reproducibility leg by
   construction, so a new node cannot regress those (OWN-THE-BUILD Part B).
10. **Bundle + ledgers** — `node tools/build.mjs --app <Node>` builds `<Node>.src.html` → `<Node>.html`
    (owned plain-inline) AND auto-writes the `BUILD-MANIFEST.json` GATE-A `manifestHash` + re-stamps its
    code-gated `FIXTURE-PROVENANCE.json` fixtures. Record NEW fixtures by re-running the app + re-exporting;
    `node tests/check-dex.mjs <node>` for the scoped both-gates check while iterating.
11. **Land both gates green** — `Dex-Test-Suite.html?full` all-green + `verify-provenance.html`
    `__provenanceOK`. Then flip your brief's header to DONE (`CLAUDE.md` brief lifecycle).

> Acceptance bar when EEGDex lands is `briefs/BADGE-COVERAGE-AUDIT-BRIEF.md`'s method (it's the pre-wired example:
> `codegen/generated/eegdex-registry.js` already projects through `cohesion-badges`).

---

## TL;DR for a coder in a hurry

1. **Three layers, one job each:** CORE (shared truth, no device logic) · DSP (one signal's math, no
   UI) · UI (rendering, no signal logic).
2. **Dependencies point downhill** (UI→DSP→CORE); **nodes never import each other** — only via the
   export contract.
3. **Contracts are the product.** Back-compat always; the test suite is the guardian; never edit an
   assertion to hide a break.
4. **Be honest:** evidence ladder on every metric; `null` not fabricated; conf ≠ quality; capability
   before consensus.
5. **Per-signal authority, quality-gated.** No global "best device."
6. **Stay local & reproducible.** Edit inputs, re-bundle, pass both gates.
7. **The layer-separation refactor is forward-first, one node at a time, never mid-rollout.**
