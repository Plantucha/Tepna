<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Contributing to GanglioR (the -Dex suite)

Welcome. This is the **one page that gets you oriented** — read it before the briefs.
There are ~30 `*-BRIEF.md` / `*-README.md` files in this repo; they are *deep dives*, not
the on-ramp. This file plus the **[visual architecture map](wiring/How%20It's%20Wired%20-%20Architecture.html)**
and the **[wiring guides](wiring/How%20It's%20Wired%20-%20the%20Dex%20Suite.html)** are the on-ramp.

> `CLAUDE.md` is the constitution — it wins on any conflict, especially **the Clock Contract**
> and **the two gates**. This file is the friendly summary of it.

---

## 1. What GanglioR is, in 60 seconds

A **browser-native, 100%-local** physiological-analysis instrument framework. A fleet of
single-signal analyzers (the **-Dex** nodes) plus a shared event bus (**Ganglior**) and a
fusion layer (**the Integrator**). Read end-to-end it is a **reflex arc**:

```
   receptors          relay              integration          insight
   ──────────         ───────            ────────────         ─────────
   the -Dex     ─▶    Ganglior     ─▶    the Integrator  ─▶   "ANS Intelligence"
   nodes              event bus          fusion layer         (the read-out)

   OxyDex   · blood oxygen          (O2Ring)
   ECGDex   · heart electrical      (Polar H10)
   PulseDex · beat-to-beat RR       (Verity Sense)
   PpgDex   · raw wrist PPG         (Verity Sense)
   HRVDex   · daily HRV summary     (Welltory)
   GlucoDex · continuous glucose    (CGM)
   CPAPDex  · CPAP therapy          (ResMed AirSense)
```

Each node **senses one signal** and emits events onto Ganglior. The Integrator **fuses** them.
Nodes never talk to each other directly — only through the export contract.

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

The bundle's **`manifestHash`** (SHA-256[0:12] of a UUID-independent projection of its
`__bundler/manifest` — the inlined executed JS/CSS) is the instrument's code fingerprint. **Any** code
change shifts it; an inert re-bundle of identical source does not. (`buildHash` is **retired** — no gate
reads it; see gate #2.) After a code change, update `BUILD-MANIFEST.json` and regenerate any committed
fixture whose output the change moved.

---

## 4. The two gates — run after **every** change

These make the contracts real. Treat a red as a **blocker**, not a nitpick.

> **Try the live gate first (GATE-LIVE-RUNNABILITY 2026-06-28).** `Dex-Test-Suite.html`'s
> render-coverage legs boot real bundles in hidden iframes; whether that reach-in is blocked is
> **host-specific**, not a law of the preview. On a **same-origin** preview (observed here) it runs
> **green in-environment** — no external host needed. (`verify-provenance.html` is now **pure-static**
> — Phase 7 — so it has no iframe reach-in and runs on any host.) Only fall back to
> `node tests/run-tests.mjs` / a static host if the live behavior gate is ACTUALLY blocked — read the
> prose-immune signal `window.__sameOriginOK` (set by both harness pages; on the SUITE it only goes
> true once render-coverage has actually run, so open `Dex-Test-Suite.html?full` or click ▶ first —
> `verify-provenance.html` sets it unconditionally), NOT a keyword-scan of the page body (which now
> contains the very words such a scan matches).

> **No Node host in the authoring environment → the browser gates ARE authoritative here (do NOT
> re-file "Node-CI debt").** The fast-loop CLIs — `tests/check-dex.mjs`, `tests/reconcile-provenance.mjs`,
> `tests/verify-manifest.mjs`, `tests/run-tests.mjs` — run the SAME single-source logic the browser pages
> run (`tests/dex-tests.js` for behavior; `manifest-gate.js` for provenance). So when there is no shell,
> `Dex-Test-Suite.html?full` + `verify-provenance.html` **are** the gate, not a substitute — a green
> browser read is a **discharge, not debt**. `node tests/*.mjs` is the CI mirror (GitHub Actions), run
> when a Node host exists; its literal invocation being unrun in a no-shell session is **expected — state
> it once, not per brief.** This closes the recurring "standing Node-CI debt" carried across
> `SIGNAL-ADAPTER-FOLLOWUPS -IV §7 … -XII §3`, the `ECGDEX/PPGDEX/GLUCODEX-FOLLOWUPS`, and
> `GENERIC-EMIT-GATE-FOLLOWUPS-II/III`: a browser-only pass is complete; do not add a new tracker.
> (For the reconcile ledger-edit that `reconcile-provenance.mjs` computes, the browser now has the same
> report — `verify-provenance.html` §3 Reconcile.)

1. **Behavior — `Dex-Test-Suite.html`.** Render-coverage is **on-demand** (lazy, 2026-06-30): a bare
   open paints only the headless floor in ~3 s and the pill reads amber **`✓ headless green ·
   render-coverage not run — ▶ or ?full`** — that is the floor, **NOT a pass**. To run the FULL gate,
   open **`Dex-Test-Suite.html?full`** (or click **▶ Run render-coverage**); the rigs then boot for
   ~30–50 s — **wait for the group count to stop climbing**, then read the `#summary` pill — it must be
   **all green** (`✓ all green` / `0 fails`, `window.__rcState==='done'`). **Only the green / 0-fails verdict is authoritative — the
   absolute pass- and group-COUNTS are advisory snapshots, NOT a regression baseline.** The browser-only
   render-coverage legs boot real app bundles in a hidden `<iframe>` and are included/sized by *timing*
   (per-leg watchdogs), so the counts drift run-to-run with no code change (observed ~1084→1146 passes /
   68→72 groups across reloads in ONE session, every time all-green). Do **not** diff a recorded count
   (the `1176/75`-style numbers in execution logs are snapshots, not invariants) to detect a regression —
   it produces false alarms. The pill is the signal (GENERIC-EMIT-GATE-FOLLOWUPS §3). **The green pill also
   appears *incrementally*** — the render-coverage groups push as their iframes finish booting (~50 s to
   settle; the group count climbs, e.g. 70→79), so a green read at ~6 s can be **green-but-incomplete**.
   Only `✓ all green` **after the group count has stopped climbing** is a pass (`verify-provenance.html`
   is pure-static — Phase 7 — and settles in ~10 s as it hashes every committed input + output; read
   `window.__provenanceOK`). (GATE-LIVE-RUNNABILITY §4 —
   reinforces GENERIC-EMIT-GATE-FOLLOWUPS §3.)
   Run it after editing any `*-dsp.js` / `*-cross.js` / `*-app.js` and after re-bundling.
   (CI mirror: `node tests/run-tests.mjs` — same `tests/dex-tests.js` assertions.) A live spot-check on
   one file is **not** a substitute — the suite catches contract breaks an ad-hoc check misses.
   **Run it in ONE tab at a time.** The render-coverage groups boot real app bundles in a shared hidden
   `<iframe>` on fixed 8 s / 12 s budgets, so two concurrent runs (e.g. a manual preview + a forked
   verifier) contend for wall-clock and can throw a transient red — most often *`Render coverage —
   ECGDex … bundle loads in iframe`* (onload missed) or the *OxyDex heavy-dropout watchdog* (12 s
   timeout). A lone one of those under contention is a **flake**: re-run isolated before treating it as
   real (SIGNAL-ADAPTER-FOLLOWUPS-X §3).
2. **Provenance — `verify-provenance.html`.** Run after **re-bundling** any `Foo.html`. Pure-static,
   content-addressed (Phase 7): **GATE A** asserts each bundle's `manifestHash` matches
   `BUILD-MANIFEST.json` — update that entry after any code-changing re-bundle. **GATE B** audits each
   `FIXTURE-PROVENANCE.json` fixture as a known-answer triple `hash(input) + manifestHash → hash(output)`;
   a fixture reds the moment its bundle's code, an input, OR the output changes. So whenever a code change
   moves a node's export, **regenerate that fixture** (re-run the app + re-export, never hand-edit) and
   re-record its `{ manifestHash, inputHashes, outputHash }`. Confirm **no red verdicts** (read
   `window.__provenanceOK`). `buildHash` is retired — no gate reads it. (CI mirror:
   `node tests/verify-manifest.mjs` runs GATE A + best-effort GATE B.)

> **Section-scoped runs (SECTION-SCOPED-RUNS 2026-07-01) — a dev convenience, NEVER the gate.** All
> three gate surfaces take the SAME filter (comma = OR; each term is case-insensitive, tried as a regex
> then as a literal substring; matches a group's title OR tag), so while iterating on one dex you can run
> just its section — far faster, and it won't red on a parallel coder's in-flight edit to *another* dex:
> - **Suite:** `Dex-Test-Suite.html?group=oxydex` (or type in the filter box) — scopes BOTH the headless
>   groups AND which render-coverage rigs boot (skip the ~30–50 s of booting unrelated app iframes).
> - **Node CI mirror:** `node tests/run-tests.mjs --group=oxydex` (aliases `-g` / `--only`, or the
>   `DEX_GROUP` env var).
> - **Provenance:** `verify-provenance.html?bundle=oxydex` — scopes GATE A + GATE B to the matching
>   bundle(s) only. Fast CLI mirror: `node tests/verify-manifest.mjs --bundle=oxydex` (aliases
>   `--only` / `-b`, or `DEX_BUNDLE`).
>
> A filtered run is marked LOUDLY everywhere — the suite pill shows `⦷ FILTERED … not the full gate`
> (and `✓ scoped green`, never `✓ all green`), the Node runner prints a `FILTERED RUN` banner, the
> provenance page shows a FILTERED bundle-count badge, and `window.__filtered` carries the pattern. **The
> canonical merge gate is always the UNFILTERED run** (`✓ all green` / `window.__provenanceOK`). A filter
> that matches zero groups/bundles is a hard error, not a pass.
>
> **One-liner for "did I break ONE dex?":** `node tests/check-dex.mjs oxydex` runs BOTH scoped headless
> lanes (behavior `run-tests --group` + provenance `verify-manifest --bundle`) and exits 0 iff both pass.
> It's the tight inner-loop check while iterating on one `*-dsp.js`/registry — NOT a substitute for the
> unfiltered sweep + `?full` render-coverage (it reminds you of that on green).
>
> **Reconcile helper (READ-ONLY):** after a re-bundle moves a `manifestHash`, `node tests/reconcile-provenance.mjs
> --bundle=oxydex` recomputes the settled hash, classifies the change (**RECONCILED** / **EXPORT-INERT** /
> **OUTPUT-MOVED**), and prints the EXACT `BUILD-MANIFEST.json` + `FIXTURE-PROVENANCE.json` edit to make —
> it **NEVER writes** (PROVENANCE-NONDETERMINISM §2/§4: an auto-writer would race the platform's out-of-band
> rebuild). Apply its edits by hand AFTER the build settles, then re-run it to confirm RECONCILED; if it
> already flipped to RECONCILED, the concurrent writer synced it — do nothing. For OUTPUT-MOVED it refuses
> to print an output hash: regenerate the fixture by re-running the app + re-exporting, never hand-paste.

**The shared assertions in `tests/dex-tests.js` ARE the public contract.** If you intentionally change
a function signature or return shape, **keep back-compat** (add new params LAST + optional; expose new
data via a NEW field/method) — don't edit an assertion to hide a break. If a doc and the code-shipped
registry disagree, **fix the doc**, not the registry.

---

<<<<<<< HEAD
=======
---

## 4.5 Dev commands — the `npm run` spine

The root **`package.json`** is a **dev-tooling manifest only** — `private`, unpublished, declares
**no runtime dependencies**, ships nothing, is fetched by nothing at runtime (the 100%-local /
offline / single-file invariant is untouched, same contract as `tsconfig.json`). It is the single
command surface that unifies the build tooling and the gate runners; the CI workflows call these same
scripts, so a command lives in exactly one place. No `npm install` is needed for the pure-Node
scripts; the two pinned dev tools (`tsc`, ESLint) self-install via `npx -y` on demand.

| Command | Runs | When |
|---|---|---|
| `npm run check` | typecheck → lint → test → build-core → build:check → verify:manifest | the full Node-lane floor — run before you call it done |
| `npm test` | `node tests/run-tests.mjs` | after any `*-dsp.js` / `*-cross.js` / `*-app.js` change |
| `npm run typecheck` | `tsc --noEmit --checkJs` (pinned) | after touching a `tsconfig`-scoped module |
| `npm run lint` | ESLint over `*.js`/`*.mjs` (pinned, **never** `--fix`) | control-flow / dead-code floor |
| `npm run build` / `build:app -- <Name>` / `build:check` | `tools/build.mjs --all` / `--app` / `--check` | re-bundle owned bundles / drift guard |
| `npm run verify:manifest` | `tests/verify-manifest.mjs` | provenance GATE A after a re-bundle |
| `npm run gen:lists` | regenerate `docs-ledger-list.json` + `changes-list.json` | after adding/removing a brief, linkable file, or changeset |
| `npm run release` / `release:dry` | `tools/release.mjs` | cut a release from a green tree |

> The `npm run` names are a convenience layer, **not** a new gate. The canonical gates are still
> `Dex-Test-Suite.html?full` (behavior) and `verify-provenance.html` (provenance); the browser reads
> are authoritative here when there is no Node host (§4 above). Never add a shipped dependency to
> `package.json` — it declares dev tooling only.

---

>>>>>>> cf3e242 (Tepna suite)
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

## 6. Non-negotiables (skim, then internalize)

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
  duplicated `parseTimestamp`; the finished `REFACTOR-BRIEF-modularize-Dexes.md`.

---

## 7. Where to go next

- **Visual map:** [How It's Wired — Architecture](wiring/How%20It's%20Wired%20-%20Architecture.html) — the whole system on one page.
- **Per-node wiring:** [the -Dex suite index](wiring/How%20It's%20Wired%20-%20the%20Dex%20Suite.html) — file stack, data flow, evidence ladder, limits, how-to for each node, the Integrator, SynthGen, the experiments, and the papers.
- **The constitution:** `CLAUDE.md` (rules) · `ARCHITECTURE-PRINCIPLES.md` (the why) · `LEXICON.md` (naming).
- **Deep dives (only when you need them):** `INTEGRATOR-BUILD-BRIEF.md`, `CPAPDEX-BUILD-BRIEF.md`,
  `SYSTEM-COHESION-BRIEF.md`, `CLOCK-UNIFY-BRIEF.md`, and the rest of the `*-BRIEF.md` set.

Drafts and synthetic experiments are for research and curiosity — **not a medical device, not for
diagnosis.** Label every claim honestly: simulation vs real-detector vs real-data.

Thanks for contributing. 🧠
