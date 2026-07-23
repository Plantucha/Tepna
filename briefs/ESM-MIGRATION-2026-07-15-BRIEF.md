<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-07-23 (Phases 0–2 done; **Phase 3 fan-out COMPLETE**; **Phase 4 executed in the owner-scoped MIDDLE PATH**. **The remaining Done-when items 4–5 are now EXECUTED (2026-07-23), closing this brief:** (4) the DSP→UI reach-ins were inverted to **dependency injection** — hrvdex-dsp (14 reach-ins) + oxydex-dsp (17), the only two nodes with real reach-ins — each export-inert (headless-safe `_ui.*` hook defaults reproduce the golden; only `computeHash` moved), and the seven per-node `<node>-globals.d.ts` were consolidated to one grouped `node-globals.d.ts` (type-only, no re-bundle); (5) the source-mirror `<node>LoadOwnExport` attach-marker gates were already retired in intervening work, and the reach-in allow-list gate was behavioralized to ASSERT the boundary is clean (0 reach-ins remain fleet-wide). `ARCHITECTURE-DEBT-REDUCTION §P5` flipped to DONE-via-this-brief. Landed as staged gated PRs **#370 / #372 / #373**. The residual `ESM-MIGRATION-FOLLOWUPS-II` items 1–2 (test-suite bare→namespace rewrite + spray deletion) are the additive node-realm sweep — NOT part of this brief's Done-when — tracked there.) · **Created:** 2026-07-15

# ESM migration — make the DSP↔render coupling a real module boundary (spike first, decide, then fan out)

> **What this is.** The executable spin-out of **P5** of `ARCHITECTURE-DEBT-REDUCTION-2026-07-14-BRIEF.md`
> (which is *research/decision only* and stays deferred there). P5's own rule: *"If/when it is taken up, it
> becomes its own multi-phase brief (`ESM-MIGRATION-YYYY-MM-DD-BRIEF.md`), not a phase there."* This is that
> brief. **Nothing here is committed to yet.** Phase 0 is a throwaway **spike** whose only deliverable is a
> go/no-go answer; every later phase is *conditional on Phase 0 clearing the inliner wall*. Do NOT start
> Phase 1 until Phase 0 is green and the owner has said go.
>
> **Supersedes:** none. **Superseded-by:** none.

---

## Why this is worth revisiting now (and why it was deferred)

**The debt ESM would remove.** Each node is 4–5 *plain global scripts sharing page scope* (`<node>-dsp` /
`-render` / `-app` / `-profile` / `-registry`, all bare globals attached to `global.<Node>`). That implicit
coupling is *why*:
- every `<node>-globals.d.ts` ambient file exists (to tell tsc what the sibling globals are),
- `parseTimestamp` was once copy-pasted per node (no import to share it — fixed by inlining `clock.js`),
- the checkJs type gate cost ten PRs (#70–#79) of per-node archaeology, and
- a whole family of **source-text mirror gates** in `tests/dex-tests.js` exists — they assert coupling by
  *regex-reading raw source* because there is no module boundary to check. **P4's whole-tree Biome reflow
  broke ~14 of these** (they read un-canonical source the reflow normalized). That breakage is the live,
  recurring tax ESM would end: with real `import`/`export`, the coupling is machine-checked by the module
  system and most of those `.d.ts` files + source-mirror gates simply disappear.

**Why P5 was deferred (and what changed).** The original cost objection was three-fold: (1) it touches every
node + `dex-coload.js` + the inliner, (2) it churns every `manifestHash`, and (3) the type gate *already*
made the coupling visible, capturing much of ESM's benefit. Points (1)/(2) were priced for the **constrained
cloud/CI lane** (no browser, gitignored corpus absent, parallel sessions forcing serialization). Executed
**alone on a local machine with the full corpus and headless Chromium**, several of those costs drop sharply:
- the **browser gates run locally** (`Dex-Test-Suite.html?full`, `verify-provenance.html`, the `no-network`
  runtime layer) — the exact gates that de-risk "does the bundled offline `Foo.html` still boot offline",
  which are CI-only in the cloud env;
- the **fixture re-verification is one command** (`DEX_UPLOADS=<corpus> node tools/verify-fixtures.mjs`) —
  ESM moves every `computeHash`, expiring all 14 corpus-backed `verifiedUnder` stamps, and the local corpus
  discharges that in a single green run (exactly as F1 did after P4);
- **one-shot, single-session** work sidesteps the `§👥.3` serialize-the-ledgers tax entirely.

**What local horsepower does NOT fix — the real gate.** The one cost that is *architectural, not
environmental*: **can the owned inliner (`tools/build.mjs`) bundle an ES-module node into a single,
self-contained, offline `Foo.html` that still passes `no-network` + GATE A/B?** The 100%-local / single-file
/ offline invariant forbids a bundle that `fetch`es sibling modules, and `<script type="module">` under
`file://` hits the opaque-origin / CORS failure that already bit the analysis tools
(`LOCAL-DOWNLOAD-FILE-URL-FIX-2026-07-14`). So the inliner must gain **real ESM bundling** — resolve the
import graph, order it, and concatenate to a single classic `<script>` (or one inline module) with no
network edges. A fast box lets you *test* that answer cheaply; it does not *answer* it. **That is precisely
why Phase 0 is a spike, and why it is mandatory before any fan-out.**

---

## Invariants this migration MUST NOT break (non-negotiable — from CLAUDE.md)

1. **100% local / single-file / offline.** Each `Foo.html` stays one self-contained file with no network,
   no CDN, no `@font-face`, no runtime module fetch. Gate: `no-network.html` (+ CI).
2. **The Clock Contract** (`clock.js` single-sourced, inlined into every bundle; delegating DSPs alias
   `DexClock`). ESM must preserve `parseTimestamp` single-sourcing — an `import { DexClock }`, never a
   re-fork.
3. **Provenance identity.** `manifestHash` stays the deterministic plain-inline projection
   (`manifest-gate.js`); a converted bundle must still be an owned deterministic plain-inline bundle (NOT the
   retired legacy gzip/UUID format — that hashes to `null` and reds GATE A). `computeHash` WILL move (a
   compute-closure change) → re-verify fixtures per §🔏 / the FIXTURE-VERIFICATION-GATE.
4. **The event-bus codename `Ganglior` + the `ganglior.node-export` schema + the `fascia` alias are FROZEN.**
   Renaming files/symbols to ESM must not touch these identifiers.
5. **Evidence badges, units (metric-canonical), licensing SPDX headers** — unchanged; ESM is a wiring
   change, not a behavior change. Every phase is behavior-inert (export bytes unchanged) unless explicitly
   noted, and that inertness is *computed, not asserted* (equiv/GATE-C legs + `verify-fixtures`).

---

## Phase 0 — the INLINER SPIKE (throwaway; the go/no-go gate) · **do this and STOP**

**Goal.** Prove, on **one** node, that the owned build can turn ES-module source into a single offline
`Foo.html` that passes every gate — or find the wall. This is the entire decision. Budget it as a spike:
timebox, expect to throw the code away, keep only the finding.

**Spike node: GlucoDex.** Chosen deliberately — it is the **smallest** node (5 files: `glucodex-app` /
`-dsp` / `-render` / `-registry` / `-profile`), ships **no Web Worker** (only PpgDex does — its worker blob
is the hardest ESM surface, save it for last), keeps a **self-contained node-local clock variant** (so the
spike doesn't also have to solve shared-module ESM ordering), and owns a small fixture set (3) for GATE B.

**Do it behind a flag, non-destructively:**
1. **Keep the classic build the default.** Add an opt-in `--esm` path to `tools/build.mjs` (or a sibling
   `tools/build-esm-spike.mjs`) so `node tools/build.mjs --app GlucoDex` is untouched and the shipped
   `GlucoDex.html` does not move. The spike writes to a scratch output (e.g. `GlucoDex.esm.html`), never
   over the committed bundle.
2. **Author an ESM copy of the 5 GlucoDex files** in a scratch dir (`spike/glucodex-esm/`): convert the
   `global.GlucoDex = …` global-attach + bare-global cross-references into `export`/`import`. Keep the
   node-local clock parser local. Do NOT touch the real source files.
3. **Teach the spike bundler to resolve + inline the ESM graph** into ONE offline `<script>` (classic, or a
   single inline `type="module"` if it passes `no-network` under `file://` — verify, don't assume). No
   network edges; the CSP stays `'unsafe-inline'` + `blob:` as today.
4. **Gate the spike output** — this is the whole point, and locally you CAN run all of it:
   - open `GlucoDex.esm.html` from `file://` and from `http://` under headless Chromium → **0 page errors,
     the app computes a real CGM summary** (the `LOCAL-DOWNLOAD-FILE-URL-FIX` failure mode must be absent);
   - `no-network` runtime layer → no fetch/module network edge;
   - compute the spike bundle's `manifestHash` via `manifest-gate.js manifestHashFromText` → it must be a
     real 12-hex (NOT `null` → that means it regressed to the legacy format, GATE A would red);
   - run GlucoDex's compute against its committed inputs and assert the export reproduces **byte-identical**
     to the classic bundle's export (volatile-stripped) — ESM is wiring, output must not move.

**Done-when (Phase 0):** a one-page **findings note** (`ESM-MIGRATION-SPIKE-FINDINGS-2026-07-15.md` in
`briefs/`, or appended here) answering: (a) can the inliner bundle ESM to a single offline `Foo.html`?
(b) does it pass `no-network` + boot under `file://`? (c) does `manifestHash` stay a valid non-null owned
hash and the export reproduce byte-identical? (d) what did it cost for ONE node, extrapolated to eight?
**Then STOP and bring the finding to the owner.** GO = the wall is cleared, fan-out (Phases 1+) is low-risk
mechanical work. NO-GO = record the specific inliner limitation; P5 stays deferred with a concrete reason
(better than today's vague "expensive").

> **Everything below is CONDITIONAL on a GO from Phase 0. Do not start it otherwise.**

---

## Phase 1 — productionize the build path (GlucoDex stays the pilot) · *conditional*

> **✅ EXECUTED 2026-07-15 — with a scope refinement forced by the co-load reality (owner-decided).**
> The DSP is co-loaded raw as a classic script by the orchestrators AND both test runners' equiv gate
> (`vm.runInContext`), AND `glucodex-registry.js` is executed classically by both suites for the
> registry-defs-parity gate — a top-level `export`/`import` in either is an immediate SyntaxError there.
> Owner chose **keep the DSP (and, by the same rule, the registry) classic**; converting them + rewiring
> ~6 classic loaders IS the Phase 2 co-load bridge. So Phase 1 converted the **3 bundle-only UI modules —
> `glucodex-render.js` + `glucodex-app.js` (real `import`/`export`) + `glucodex-profile.js` (side-effect
> module)** — and productionized the bundler as **`tools/build-core.js esmBundle`** (per-file blocks via a
> shared module registry; names preserved so computeHash stays precise). All three are display-only, so
> the landing is **export-inert BY COMPUTATION**: `computeHash` UNCHANGED at `a5bda5037069`, only
> `manifestHash` moved (`68d78c731344 → 078fbb9c0cd4`); no `glucodex-globals.d.ts` deletion and no
> `tsconfig.json` change were needed (the 3 UI files aren't type-checked; the d.ts serves the still-classic
> DSP). Full local gate sequence GREEN incl. the browser lane (`Dex-Test-Suite.html?full` all-green,
> `bootSkips:[]`; `verify-provenance` GATE A/B; `no-network`). A pre-existing browser-lane false-positive
> in FIXTURE-VERIFICATION-GATE §3.1 (fail-closed without `git ls-files`) was fixed to Node-lane-only.
> **Phase 2 now owns:** the DSP + registry ESM conversion, the co-load bridge, and the full
> `glucodex-globals.d.ts` deletion. Changeset: `changes/2026-07-15-glucodex-esm-migration.md`.


Fold the spike's proven bundler into `tools/build.mjs` as a real, gated code path (not a scratch tool):
convert GlucoDex's actual 5 source files to ESM, delete its `glucodex-globals.d.ts` (tsc now resolves the
imports), re-bundle `GlucoDex.html` for real, re-verify (`verify-fixtures.mjs` on the corpus — `computeHash`
moved), and land it as ONE node behind the now-proven path. Update `tsconfig.json` (`module`/`moduleResolution`
as needed) for the converted node only. **Files:** the 5 `glucodex-*.js`, `tsconfig.json`, `tools/build.mjs`,
delete `glucodex-globals.d.ts`. **Changeset:** `type: changed`, `nodes: [GlucoDex]` (manifestHash moves).
**Gate:** full local sequence incl. the browser lane + `verify-fixtures --check` 0 unverified.

## Phase 2 — the co-load contract + orchestrators · *conditional, the coupling knot*

> **✅ EXECUTED 2026-07-15 (owner-approved go/no-go).** Bridge chosen: **the DSP is DUAL-MODE** — it keeps
> its `window.GLUDSP`/`window.GlucoDex` attaches (option b: a `global.<Node>` surface for every classic
> co-load consumer) while `glucodex-app.js` `import`s its ESM exports. The raw classic loaders that share a
> global realm — `tests/run-tests.mjs`'s vm realm (via `loadInto`), `tools/regen-glucodex-goldens.mjs`, and
> `Dex-Test-Suite.html`'s harness — classic-load it through a new shared **`DexBuild.classicify`** (sheds the
> top-level `import`/`export`; no-op on classic files); the two orchestrators (`Data Unifier.html`,
> `OverDex.html`) mark it `type=module` so `esmBundle` wraps it (self-triggering, identical load timing). The
> `dex-coload manifest` gate stayed GREEN throughout. `computeHash` moved (`a5bda5037069 → 849db418fb72`,
> `manifestHash → 1e92a7c23fe7`) — the DSP is a compute asset — but EXPORT-INERT BY VERIFICATION: the equiv/
> golden legs reproduce byte-identical and `verify-fixtures.mjs` re-stamped the corpus-backed fixture's
> `verifiedUnder` after a green real-corpus run. Full local gate sequence green incl. browser lane; biome + tsc
> clean. **NOT deleted:** `glucodex-globals.d.ts` — the DSP still attaches `window` for the classic consumers,
> so the ambient declarations are still load-bearing; deletion waits until those consumers are ESM (Phase 4).
> The "second wall" (the shared vm realm + browser harness) was cleared by the `classicify` bridge, which is
> the reusable mechanism Phase 3's fan-out inherits. Changeset: `changes/2026-07-15-glucodex-esm.md`.


`dex-coload.js` + the signal-orchestrate hosts (`Data Unifier.html`, `OverDex.html`) co-load DSPs as **plain
global scripts**. Converting a DSP that an orchestrator co-loads breaks that host. Decide the bridge:
either (a) the orchestrators import the ESM DSPs too, or (b) keep a thin `global.<Node>` compatibility
shim emitted by the build for co-load consumers during migration. Keep the `dex-coload manifest` gate green
throughout (it asserts every host co-loads every module). **This is the phase most likely to surface a
second wall** — treat it as its own go/no-go if it does.

## Phase 3 — fan out the remaining nodes (cheapest-first) · *conditional, mechanical*

> **⏸ PARKED 2026-07-16 (owner-decided) — see `ESM-MIGRATION-FOLLOWUPS-2026-07-16-BRIEF.md`.** On
> inspection the fan-out is NOT mechanical: each remaining node has a structural blocker (indirect DSP
> consumption with no clean import edge in oxydex/hrvdex/pulsedex; no-IIFE `render`/`overview` in pulsedex;
> a Web-Worker blob in ecgdex AND ppgdex; edf/fusion/cross + non-orchestrator co-load in cpapdex; and a
> load-order hazard that makes any DSP-only conversion either a dead-export churn or a risky bespoke UI
> change). The P5 payoff (delete `-globals.d.ts`, retire source-mirror gates) only lands once the fan-out is
> COMPLETE and the classic co-load path is retired, so a partial fleet unlocks nothing. GlucoDex stands as
> the fully-migrated reference + the generic `esmBundle`/`classicify` bridge is fleet-ready; the follow-up
> brief captures the per-node blockers + the completion recipe for when the full migration is funded work.


With the path proven and the co-load bridge chosen, convert the rest cheapest-first — roughly
`pulsedex (6)` → `hrvdex (7)` → `ecgdex (7)` → `oxydex (8)` → `cpapdex (8)` → **`ppgdex` LAST** (its Web
Worker blob is the one surface that must also ship ESM into a worker realm; the existing
`_ppgWorkerSource`/`worker blob EXECUTES` gates are the safety net). One node per PR, each: convert →
delete its `-globals.d.ts` → re-bundle → re-verify fixtures on the corpus → changeset. As each node's
coupling becomes import-checked, **retire the corresponding source-mirror gates** in `tests/dex-tests.js`
(the P4-hardened regexes) in favor of the module boundary — the net debt reduction P5 exists for.

## Phase 4 — sweep the dead scaffolding · *conditional*

> **⏸ EXECUTED IN PART 2026-07-16 (owner-scoped middle path)** — measurement showed the scaffolding is
> NOT dead: the sprays feed the test suite (hundreds of deliberate bare calls) + six workers, and the
> `-globals.d.ts` files are pinned by DSP→UI reach-ins. What DID land: app pages namespaced
> (`__DEX_NAMESPACED__` in the three deep-3 shells), explicit `_bare` destructure imports in every UI
> module, namespace proxies for mutable state — the import boundary is real and machine-verified in the
> product. The remainder (test-suite rewrite → spray deletion, reach-in inversion → d.ts deletion,
> source-mirror-gate behavioralization) is precisely scoped in `ESM-MIGRATION-FOLLOWUPS-II-2026-07-16-BRIEF.md`
> (PROPOSED/parked). This brief's Done-when stays open on exactly those items.

Remove the now-unused `<node>-globals.d.ts` files, dead `global.<Node>` attaches, and the retired
source-mirror gates; update ORIENTATION/ARCHITECTURE docs to describe the module boundary. Flip
`ARCHITECTURE-DEBT-REDUCTION`'s P5 note from deferred to DONE-via-this-brief.

---

## Cross-cutting gates (run the FULL sequence locally after every node phase)

```sh
npx -y @biomejs/biome@2.5.3 ci                                 # format + lint, whole tree
npx -y -p typescript@5.5.4 tsc --noEmit -p tsconfig.json       # types (fewer .d.ts now)
node tools/build.mjs --check                                   # bundle drift (all 10 owned)
node tests/run-tests.mjs --quiet                               # full node suite
node tests/verify-manifest.mjs                                 # GATE A/B
DEX_UPLOADS=<corpus> node tools/verify-fixtures.mjs            # re-stamp verifiedUnder (computeHash moved)
# browser lane (LOCAL Ubuntu + headless Chromium — the reason this is a local job):
#   Dex-Test-Suite.html?full  → all-green pill, bootSkips:[]
#   verify-provenance.html     → __provenanceOK true
#   no-network.html            → no network edge (esp. under file://)
```

## Done-when (whole brief)

Phase 0 answered GO/NO-GO with a committed findings note. IF GO and fan-out completed: every node is ESM,
the co-load contract bridged, the `<node>-globals.d.ts` scaffolding + the obsolete source-mirror gates
retired, every bundle re-bundled + fixtures re-verified on the corpus, all local gates (incl. browser lane)
green, and `ARCHITECTURE-DEBT-REDUCTION` §P5 flipped to DONE. IF NO-GO: this brief stays `PROPOSED (deferred
YYYY-MM-DD — <the specific inliner limitation Phase 0 found>)`, which is a strictly better parked state than
today's undifferentiated "expensive".
