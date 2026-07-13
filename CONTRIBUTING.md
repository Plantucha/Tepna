<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Contributing to Tepna (the -Dex suite)

Welcome. This is the **one page that gets you oriented** — read it before the briefs.
There are many `*-BRIEF.md` / `*-README.md` files in this repo (all indexed in `DOCS-INDEX.md`); they are *deep dives*, not
the on-ramp. This file plus the **[visual architecture map](wiring/How%20It's%20Wired%20-%20Architecture.html)**
and the **[wiring guides](wiring/How%20It's%20Wired%20-%20the%20Dex%20Suite.html)** are the on-ramp.

> `CLAUDE.md` is the constitution — it wins on any conflict, especially **the Clock Contract**
> and **the two gates**. This file is the friendly summary of it.

---

## 1. What Tepna is, in 60 seconds

A **browser-native, 100%-local** physiological-analysis instrument framework (**Tepna** — the product
brand; **Ganglior** is the FROZEN event-bus codename, distinct from the brand). A fleet of
single-signal analyzers (the **-Dex** nodes) plus a shared event bus (**Ganglior**) and a
fusion layer (**the Integrator**). Read end-to-end it is a **reflex arc**:

```
   receptors          relay              integration          insight
   ──────────         ───────            ────────────         ─────────
   the -Dex     ─▶    Ganglior     ─▶    the Integrator  ─▶   autonomic insight
   nodes              event bus          fusion layer         (the read-out)

   OxyDex   · blood oxygen          (O2Ring)
   ECGDex   · heart electrical      (Polar H10 `*_ECG.txt`)
   PulseDex · beat-to-beat RR       (Polar H10 `*_RR.txt`)
   PpgDex   · raw wrist PPG         (Polar Verity Sense `*_PPG.txt`)
   HRVDex   · daily HRV summary     (Welltory)
   GlucoDex · continuous glucose    (CGM)
   CPAPDex  · CPAP therapy          (ResMed AirSense)
```

Each node **senses one signal** and emits events onto Ganglior. The Integrator **fuses** them.
Nodes never talk to each other directly — only through the export contract.

> The **gate-backed roster** (each node's signal · device source · files) lives in **`ORIENTATION.md`** —
> the single source of truth; the diagram above is the 60-second view, not an authority to fork.

**Three advantages we protect above all** (in priority order): **reproducibility** (a bundled
`Foo.html` is a frozen, hash-verifiable instrument), **portability** (one file, no install, no
server, runs from `file://`), **auditability** (provenance + tests trace every number). A change
that improves "cleanliness" but weakens these is the wrong change.

---

## 2. The three layers (the whole mental model)

Every file belongs to exactly **one** layer with **one** job. Dependencies point **downhill only**.

| Layer | What it does | Rule | Files |
|---|---|---|---|
| **CORE** | shared, frozen-ish truth | no device-specific knowledge, ever | `kernel-constants.js` · `metric-registry.js` · `crossnight-envelope.js` · `ganglior-provenance.js` |
| **DSP** | one node's signal math | no UI, no DOM, no `localStorage` | `<node>-dsp.js` (+ `-morph` / `-edf` / `-profile`) |
| **UI** | rendering & input | **no signal logic** — ask DSP for the number | `<node>-render.js` · `<node>-app.js` · `<Node>.src.html` |

```
            ┌─────────── CORE ───────────┐   ← depends on nothing
            │ kernel · metric-registry · │
            │ envelope · provenance      │
            └──────────────┬─────────────┘
                  ▲         │ uses        ▲
        uses      │         │             │ uses
   ┌────────────────────┐   │   ┌────────────────────┐
   │   DSP (per node)   │───┘   │  Integrator fusion │  consumes node EXPORTS,
   │  pure signal math  │       │  (cross-node)      │  never node internals
   └─────────┬──────────┘       └────────────────────┘
             ▲ calls
   ┌────────────────────┐
   │   UI (per node)    │   depends on its DSP + CORE; never on another node
   └────────────────────┘
```

**The one test that settles every "where does this go?" argument:**
*If I deleted this line, would a **number** change, or only its **appearance**?* Number → DSP.
Appearance → UI. Identical regardless of which signal the node measures → CORE.

---

## 3. How a node is built (and the golden build rule)

Each app is assembled from external `*.js` files referenced by `<Node>.src.html`, then **bundled**
into a standalone `<Node>.html`.

> ### ⛔ Edit the `*.js` + `<Node>.src.html`. **Never** edit the bundled `<Node>.html`. Re-bundle after changes.
> The bundle is generated output. Hand-editing it is lost on the next re-bundle and breaks provenance.

The bundle's **`manifestHash`** (SHA-256[0:12] of a projection of its owned plain-inline
`data-inline-src` assets — the inlined executed JS/CSS, no gzip/UUID; see `CLAUDE.md` §🔏 GATE A for
the exact algorithm) is the instrument's code fingerprint. **Any** code
change shifts it; an inert re-bundle of identical source does not. (`buildHash` is **retired** — no gate
reads it; see gate #2.) After a code change, update `BUILD-MANIFEST.json` and regenerate any committed
fixture whose output the change moved.

---

## 4. The two gates — run after **every** change

These make the contracts real — treat a red as a **blocker**, not a nitpick. The FULL rules — what each
gate checks, the on-demand render-coverage flow, the `manifestHash` + fixture-provenance triple, and why
"a green CI is NOT the full gate" (the real-recording equivalence legs read gitignored `uploads/`, so they
SKIP unless you point `DEX_UPLOADS=<path>` at a real corpus) — live in **`CLAUDE.md` §🧪 (behavior) and §🔏
(provenance)**, the single source. This is the operational summary.

1. **Behavior — `Dex-Test-Suite.html?full`** (CI mirror: `node tests/run-tests.mjs`, same
   `tests/dex-tests.js`). Render-coverage is on-demand: a bare open is the amber headless FLOOR, not a pass —
   open `?full` (or click **▶**), wait for the group count to stop climbing, then read the `#summary` pill;
   only `✓ all green` (`window.__rcState==='done'`) passes. **Run it in ONE tab at a time** — the rigs boot
   real bundles in a shared hidden `<iframe>` on fixed budgets, so two concurrent runs contend and can throw
   a transient red. Run after any `*-dsp.js` / `*-cross.js` / `*-app.js` edit and after re-bundling.
2. **Provenance — `verify-provenance.html`** (CI mirror: `node tests/verify-manifest.mjs`). Run after
   re-bundling any `Foo.html`: **GATE A** pins each bundle's `manifestHash` to `BUILD-MANIFEST.json`;
   **GATE B** audits each `FIXTURE-PROVENANCE.json` known-answer triple `hash(input) + manifestHash →
   hash(output)`. A code change that moves an export → **regenerate that fixture** (re-run + re-export, never
   hand-edit). Confirm `window.__provenanceOK`. `buildHash` is retired — no gate reads it.

**Scoped runs** are a dev convenience, NEVER the gate: all three surfaces take the same
`group=` / `--group` / `bundle=` / `--bundle` filter, and `node tests/check-dex.mjs <dex>` runs both scoped
lanes for one node. A filtered run is marked LOUDLY (`⦷ FILTERED … not the full gate`); the canonical merge
gate is always the UNFILTERED run. The full scoping + read-only reconcile details are in `CLAUDE.md` §🧪/§🔏.

**The shared assertions in `tests/dex-tests.js` ARE the public contract.** If you intentionally change
a function signature or return shape, **keep back-compat** (add new params LAST + optional; expose new
data via a NEW field/method) — don't edit an assertion to hide a break. If a doc and the code-shipped
registry disagree, **fix the doc**, not the registry.

---
## 4.5 Dev commands — the `npm run` spine

The root **`package.json`** is a **dev-tooling manifest only** — `private`, unpublished, declares
**no runtime dependencies**, ships nothing, is fetched by nothing at runtime (the 100%-local /
offline / single-file invariant is untouched, same contract as `tsconfig.json`). It is the single
command surface that unifies the build tooling and the gate runners; the CI workflows call these same
scripts, so a command lives in exactly one place. No `npm install` is needed for the pure-Node
scripts, and `tsc`/ESLint self-install via `npx -y` on demand. The **one** pinned devDependency is
**Biome** (`@biomejs/biome`, the formatter — see the §B2 on-touch rule below); it installs via
`npm ci` from the committed lockfile. It ships nothing and is fetched by nothing at runtime — the
100%-local invariant is untouched, exactly as `tsc` is.

| Command | Runs | When |
|---|---|---|
| `npm run check` | typecheck → lint → test → build-core → build:check → verify:manifest | the full Node-lane floor — run before you call it done |
| `npm test` | `node tests/run-tests.mjs` | after any `*-dsp.js` / `*-cross.js` / `*-app.js` change |
| `npm run typecheck` | `tsc --noEmit --checkJs` (pinned) | after touching a `tsconfig`-scoped module |
| `npm run lint` | Biome linter over `*.js`/`*.mjs` (the control-flow / dead-code floor) | the lint gate (ESLint retired — Phase 3 §B2) |
| `npm run format` | Biome `format --write` (pass paths) | **on-touch only** — a NET-NEW file, or the one file you are already re-bundling (never the tree; see §B2 below) |
| `npm run format:changed` | Biome `ci --changed` over changed `*.js`/`*.mjs` — format **+ lint floor** (check-only) | what CI (`format.yml`) enforces — validate before pushing |
| `npm run build` / `build:app -- <Name>` / `build:check` | `tools/build.mjs --all` / `--app` / `--check` | re-bundle owned bundles / drift guard |
| `npm run verify:manifest` | `tests/verify-manifest.mjs` | provenance GATE A after a re-bundle |
| `npm run gen:lists` | regenerate `docs-ledger-list.txt` + `changes-list.txt` | after adding/removing a brief, linkable file, or changeset |
| `npm run release` / `release:dry` | `tools/release.mjs` | cut a release from a green tree |

> The `npm run` names are a convenience layer, **not** a new gate. The canonical gates are still
> `Dex-Test-Suite.html?full` (behavior) and `verify-provenance.html` (provenance); the browser reads
> are authoritative here when there is no Node host (§4 above). Never add a shipped dependency to
> `package.json` — it declares dev tooling only.

### §B2 — the formatter is on-touch only, NEVER big-bang (read before you run Biome)

Biome (`biome.json`, tuned to the house 2-space / single-quote / semicolon style, `lineWidth: 200`) is a
**formatter + the house lint floor** (`assist`/import-sort stays off). Its `linter.rules` are the control-flow /
dead-code floor (`noUnreachable`, `noDuplicateObjectKeys`, `noFallthroughSwitchClause`, `useIsNan`,
`noUnusedVariables`, `noDoubleEquals`, …) — tuned so the **current tree is 0 errors** (`noAssignInExpressions` is
`warn` because the old ESLint `no-cond-assign: except-parens` has no Biome equivalent, and `noDoubleEquals`
ignores the `!= null` idiom the code relies on). Warnings are advisory (they never fail the gate).

> **Biome now owns lint (Phase 3 DONE).** ESLint was fully **retired** once Biome's floor proved parity in CI —
> `.eslintrc.json`, the `npx eslint` script, and the `lint.yml` workflow are all gone; `npm run lint` runs Biome.
> One pinned tool does format + lint; `format.yml`'s `biome ci --changed` is the sole lint gate.

The one rule that governs *when* you may apply the **formatter** (the lint floor is check-only, no `--write`):

- **CI is `--changed` and CHECK-ONLY.** `format.yml` runs `biome ci --changed` — it validates the format
  of the `*.js`/`*.mjs` a PR touched and **never `--write`s**. The untouched legacy tree is never
  checked, so the gate is green from day one and only enforces format on what's new or touched.
- **Why never a repo-wide `biome format --write`:** reflowing a **shipped** `*.js` changes its bytes,
  which on re-bundle moves that app's `manifestHash` and forces a full **fixture re-record** (`CLAUDE.md`
  §🔏) — for *identical behavior*. A "format everything" commit would flip **every** provenance fixture
  across all 8 bundles for zero functional change. So **do not** run `npm run format` over the tree.
- **The only two times you `--write` a file:** (a) a **net-new** file, before its first commit — it's
  Biome-clean by construction; (b) a shipped file you are **already re-bundling** for a behavioral
  change — fold `npm run format <thatfile>` into that re-bundle so the whitespace rides a `manifestHash`
  move + fixture re-record you were paying anyway. This is `OWN-THE-BUILD` Part C's "one file at a time,
  the next time you're already in it," applied to whitespace.

---

## 5. Common tasks — exact files + which gate

| I want to… | Touch | Then run |
|---|---|---|
| **Tweak a metric's label / tier / evidence grade** | `<node>-registry.js` (the one source of truth) | Suite |
| **Change how a metric is computed** | `<node>-dsp.js` only (never recompute in render) | Suite |
| **Restyle / re-layout** | `<node>-render.js` or the `.src.html` `<style>` | Suite, then re-bundle → Provenance |
| **Add a metric** | `<node>-dsp.js` (math) + `<node>-registry.js` (depth+evidence+cite) + envelope `_DEFS`; **then badge it on EVERY surface it appears — corner or inline (🔴 coverage mandate, `CLAUDE.md`)** | Suite |
| **Add a whole node** | follow the [LEXICON recipe](docs/LEXICON.md) §4 — pick stem → `Dex` → registry → emit on Ganglior → inherit the Clock Contract | Suite + Provenance |
| **Fix a DSP bug** | `<node>-dsp.js`; if the harness needs something DSP doesn't expose, adapt in the **harness layer**, not the shipped DSP | Suite |
| **Finish a work-unit (record what changed)** | drop a changeset in `changes/` ([`changes/README.md`](changes/README.md)) — `bump` + `type` + `brief`; your LAST action | Suite (`release-ledger`) |
| **Write up a finding** | a tool in [Experiments](wiring/How%20It's%20Wired%20-%20Experiments.html); then a paper under `papers/` (cite the live tool) | — |

After **any** of the above: re-bundle the affected app and re-run the gates before you call it done.

---

## 5.5 Running a production DSP off the main thread (the Web-Worker shim)

A proven, reusable pattern (TRIO-METHODS-REUSE §Do 1; in production in `sensor-trio-worker.js`): run
the **real, gate-tested** `*-dsp.js` detectors inside a Web Worker so a heavy batch (Monte-Carlo,
cohort, folder ingest) neither freezes the tab nor blocks the UI — and you get the *same* validated
numbers the app + papers use, not a hand-rolled approximation. The DSP-purity rule (§2 / Architecture
§1 — no DOM, no `localStorage`) is exactly what makes this possible.

The one gotcha: each `*-dsp.js` is an IIFE that references `window` **at load time**, and a worker has
no `window`. Shim it to `self` **before** `importScripts`, and honor the co-load order
(`kernel-constants.js` → `clock.js` → the DSPs, so `DexKernel` and `DexClock.parseTimestamp` exist
when the DSP wrappers evaluate):

```js
'use strict';
// window→self shim: the production DSP IIFE wrapper references `window` at load; a worker has none.
if (typeof window === 'undefined') { self.window = self; }
try {
  importScripts('kernel-constants.js', 'clock.js', 'ppgdex-dsp.js', 'ecgdex-dsp.js');
} catch (e) { /* fall back to a compact in-worker detector if a module can't load */ }

// Feature-detect before use — never assume the import succeeded:
const HAVE_ECGDSP = typeof ECGDSP !== 'undefined'
  && typeof ECGDSP.parseECG === 'function'
  && typeof ECGDSP.detectPeaks === 'function';
```

Then drive `PPGDSP` (3-LED consensus → `buildPPI` → Malik `correctRR`) / `ECGDSP` (Pan–Tompkins
`parseECG → bandpass → detectPeaks`) fully headless. **Apply it to** any tool wanting the real
detectors off the main thread — `ECG Splitter` batch mode, cohort runners, OverDex / Data Unifier
folder ingest, future node-analysis tools. Companion patterns from the same experiment (folder-ingest
night pairing, byte-weighted parallel ETA) live in the brief.

---

## 6. Non-negotiables (skim, then internalize)

- **Stage your commits by EXPLICIT PATH — never `git add -A` / `git add .` / `git commit -a`.**
  This repo is routinely worked by **several agents/sessions at once**, so the working tree is *not*
  yours alone: a blanket add sweeps up whatever a concurrent session happens to have in flight and
  publishes it under **your** commit message. It has already happened — `cabd7f7`
  ("fix(ppgdex): arbitrate the PPI spine…") also carries an unrelated CPAP corpus brief, its
  `DOCS-INDEX.md` row, and a `tests/docs-ledger-list.txt` regen, because a blanket add ran while
  another session had them staged-in-tree. Nothing was lost, but the history now misattributes two
  independent work-units to one commit. So: `git add <the exact files you touched>`, and
  `git status` before every commit to see what else is in the tree. If files you don't recognize
  appear, **leave them** — they belong to someone else's work-unit.
  Corollary: never `git checkout .` / `git stash` / `git reset --hard` a dirty tree you didn't dirty.
- **The Clock Contract** (`CLAUDE.md`). Store time as floating wall-clock `tMs = Date.UTC(...)` and
  read it back **only** with `getUTC*`. Parse vendor stamps by **regex**, never `new Date(str)`. A
  missing timestamp is **`null`, never `now()`**. `parseTimestamp` is duplicated per node **by design**.
- **Honesty is architectural.** Every metric carries an **evidence grade** (`measured ◉ → validated ●
  → emerging ◐ → experimental ○ → heuristic ◌`), **and that badge MUST be visible on every surface the
  metric appears** — KPI, card, hero/headline number, chart series, table & chip — pinned
  **bottom-right of the card** (`.ev-corner`) or **inline before the label** in crowded text. An
  unbadged surfaced number is a bug (see the 🔴 coverage mandate in `CLAUDE.md` / `dex-badges.css`). A
  raw reading and a population projection must never look alike. **Confidence ≠ quality** —
  `effConf = conf × (sqi ?? 1)`; never collapse them.
- **Nodes never import each other.** Cross-signal work happens only through the `ganglior.node-export`
  contract, consumed by the Integrator.
- **A migrated node's headless `compute()` path must be SELF-CONTAINED** (SIGNAL-ADAPTER-FOLLOWUPS-IV §4).
  The Data Unifier / OverDex / test suite co-load the namespaced DSPs (`pulsedex`/`oxydex`/`hrvdex-dsp.js`)
  in ONE realm — they do **not** load each node's render/profile siblings. So a DSP's `compute()` pipeline
  may reference ONLY: itself, `kernel-constants.js`, and its own `*-util.js` (e.g. OxyDex co-loads
  `oxydex-util.js`). Any reach-in to a render/profile sibling (e.g. `upVO2category` from
  `oxydex-profile.js`) **must be `typeof`-guarded** (`typeof upVO2category === 'function' ? … : null`) so
  the headless path can't throw — an unguarded reach-in throws on real files but passes a short synthetic
  floor (this is exactly how the latent OxyDex `upVO2category`/`computeCeilingBaselineArr` gap hid until
  §3). The Phase-9 `compute() ≡ committed export` equivalence gate + the ≥1 h floor in the suite catch it.
- **Record every work-unit as a changeset.** Your LAST repo action is to drop a `changes/*.md`
  (`bump`/`type`/`brief` — `changes/README.md`). **Never hand-pick a version;** `tools/release.mjs`
  computes it at release time from the pending changesets, so parallel coders never collide on a
  number. The `release-ledger` gate reds if code moved with no changeset.
- **100% local. No network, no CDN, ever.** Fonts are system stacks. Assets are inlined at bundle time.
- **Frozen / do-not-touch:** the bus name **`Ganglior`** (the Integrator still reads a `fascia` input
  alias for back-compat). Retired vocabulary (proxy→heuristic, composite→experimental) must not reappear.
- **Known non-issues** (see `CLAUDE.md` — don't "fix" these): no `*.woff2` / `@font-face` by design;
  duplicated `parseTimestamp`; the finished `docs-archive/REFACTOR-BRIEF-modularize-Dexes.md`.

---

## 7. Where to go next

- **Visual map:** [How It's Wired — Architecture](wiring/How%20It's%20Wired%20-%20Architecture.html) — the whole system on one page.
- **Per-node wiring:** [the -Dex suite index](wiring/How%20It's%20Wired%20-%20the%20Dex%20Suite.html) — file stack, data flow, evidence ladder, limits, how-to for each node, the Integrator, SynthGen, the experiments, and the papers.
- **The constitution:** `CLAUDE.md` (rules) · `ARCHITECTURE-PRINCIPLES.md` (the why) · `docs/LEXICON.md` (naming).
- **Deep dives (only when you need them):** `briefs/INTEGRATOR-BUILD-BRIEF.md`, `briefs/CPAPDEX-BUILD-BRIEF.md`,
  `briefs/SYSTEM-COHESION-BRIEF.md`, `briefs/CLOCK-UNIFY-BRIEF.md`, and the rest of the `*-BRIEF.md` set.

Drafts and synthetic experiments are for research and curiosity — **not a medical device, not for
diagnosis.** Label every claim honestly: simulation vs real-detector vs real-data.

Thanks for contributing. 🧠
