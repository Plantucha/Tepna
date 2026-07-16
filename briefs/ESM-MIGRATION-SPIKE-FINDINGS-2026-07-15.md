<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** REFERENCE (Phase 0 spike findings — **GO** recommended; last-verified 2026-07-15) · **Created:** 2026-07-15

# ESM migration — Phase 0 inliner-spike findings (GlucoDex)

The throwaway go/no-go spike mandated by [`ESM-MIGRATION-2026-07-15-BRIEF.md`](ESM-MIGRATION-2026-07-15-BRIEF.md)
§Phase 0. Executed locally on Ubuntu + headless `google-chrome` with the committed synthetic corpus, exactly
the environment the brief scopes this to. **Nothing shipped moved** — the spike is fully non-destructive
(`git status`: only untracked `spike/` + `tools/build-esm-spike.mjs`; the shipped `GlucoDex.html`, all real
`glucodex-*.js`, the owned build, and every ledger are byte-untouched; `provenance/GlucoDex.json` manifestHash
still `68d78c731344`).

## Verdict: **GO** — the inliner wall is cleared

The one architectural cost the brief said local horsepower cannot buy down — *can the owned inliner bundle an
ES-module node into a single, self-contained, offline `Foo.html` that still passes the invariants?* — is
answered **yes**, on all four Done-when questions.

## The four answers

**(a) Can the inliner bundle ESM → one offline `Foo.html`?** **Yes.** A dependency-free ES-module bundler
(`spike/esm-bundle-core.mjs`, ~90 lines, in the spirit of `tools/build-core.js`) resolves the sibling
`import`/`export` graph and emits **one classic `<script>`** using an internal **module registry** (each module
runs in its own function scope; `import`/`export` → `__require`/`__exports`). The REAL owned
`tools/build-core.js` then inlines that combined bundle + every shared-spine `<script>/<link>` exactly as for a
shipped bundle. Output `spike/GlucoDex.esm.html` is a genuine **owned plain-inline** bundle: **16 inlined
assets, zero external `src=`/`href=` edges, no `type="module"`, no legacy gzip/UUID format.** The import graph
the bundler ordered: `render → registry`, `app → {dsp, render, profile}`.

**(b) Does it pass `no-network` + boot under `file://`?** **Yes**, from both `file://` and `http://` under
headless Chromium: **0 page errors, 0 CSP violations**, the full ESM graph wired *in the browser*
(`GlucoDex/GLUDSP/GLUUI/GLUProfile/GluDisp/evBadge` all present — proving the registry resolved the graph at
runtime), and `GlucoDex.compute()` produced a real CGM summary (**mean 102 mg/dL, GMI 5.8%, TIR 100%, 3
Ganglior events**). The bundle keeps `connect-src 'none'`; an `errors:[]` boot with that CSP *is* the no-network
runtime proof (any fetch would throw a visible CSP error). Two supporting probes settle the brief's explicit
"verify, don't assume" on inline modules: an **inline `<script type="module">` boots fine under `file://`**
(no external import ⇒ no fetch), whereas an **external `import './dep.js'` under `file://` silently fails** (the
opaque-origin/CORS wall from `LOCAL-DOWNLOAD-FILE-URL-FIX`). That failure is *why inlining is mandatory* and why
the module-registry-into-one-classic-`<script>` shape is the right target — it removes every import edge.

**(c) Valid non-null `manifestHash` + byte-identical export?** **Yes.** `spike/GlucoDex.esm.html` →
`manifestHash 023172618bf1` (a real 12-hex; `build-core` and the `manifest-gate.js` page function agree; **not
`null`**, so it is NOT the retired legacy format that would red GATE A). And ESM is proven inert *by
computation, not assertion*: `GlucoDex.compute()` on both committed synthetic inputs reproduces the export
**byte-identical**, ESM ≡ classic global-scripts ≡ the committed golden (volatile-stripped, the equiv gate's own
exclusion set) — `synthetic_glucodex_lingo.csv` → `bd102bb68cf9fdce`, `…_gap.csv` → `56f4b65aed8f8967`, both
matching on each realm. This holds because the executed compute code (`glucodex-dsp.js`) is untouched; ESM only
rewired how modules are exposed. (The real Phase-1 landing still owes `computeHash` re-verification via
`verify-fixtures.mjs` — the compute closure's *hash* moves even though the *bytes* don't.)

**(d) Cost for one node → eight.** The per-node conversion is **tiny and mechanical**: keep each
`(function (global){…})(window)` IIFE intact (it still receives `window` as `global`, so every shared-spine
`global.MetricRegistry`/… reference and every `global.<Node> =` attach works verbatim — *zero body edits*),
and add `import`/`export` only for the ~7 inter-node symbols. Measured diff vs real source: **registry 3 lines ·
dsp 2 · render 9 · profile 2 · app 7 = ~23 changed lines** for the whole node. Because the registry preserves
per-module scope, shared inner names (`el`×4, `clamp`×2, `mean`, `std`, `fmt`) never needed renaming — the
reason the diff stays small (a naive single-`type=module` scope-merge would collide on all of them and is
therefore *not* viable). Extrapolated to eight nodes: the wiring edit scales with file-count (7–8 files for the
bigger nodes, same trivial per-file edit), plus these one-time items the spike did NOT fully exercise:
productionizing the bundler into `build.mjs` (Phase 1), deleting each `<node>-globals.d.ts`, and re-verifying
fixtures on the corpus. **PpgDex's Web-Worker blob remains the one genuinely harder surface** (ESM must reach a
worker realm) — correctly slated last by the brief.

## The next wall to expect (not an inliner wall)

Phase 0 clears the *inliner* wall. The brief's own **Phase 2 (co-load contract)** is the likeliest second
go/no-go: `dex-coload.js` + the orchestrators (`Data Unifier.html`, `OverDex.html`) co-load DSPs as **plain
global scripts**, and a converted node still publishes its `window.<Node>` external API — the spike deliberately
kept those window attaches (that is *why* the headless realm, `regen-*` tools, and orchestrators keep reading
`window.GlucoDex`/`window.GLUDSP` unchanged). So the external `window` contract survives conversion for free;
the open question is whether the orchestrators import the ESM DSPs or keep a build-emitted `global.<Node>` shim.
That is a wiring decision, not an architectural blocker.

## Reproduce

The throwaway `spike/` scaffold + `tools/build-esm-spike.mjs` were **removed after Phase 1/2 productionized
the bundler** — its module-registry logic now lives as `DexBuild.esmBundle` in `tools/build-core.js` (with
the co-load `DexBuild.classicify`), gated by the real suite. To reproduce the spike's evidence against the
shipped path: `node tools/build.mjs --app GlucoDex` (prints the resolved import graph + manifestHash) then the
full gate sequence below. The spike's boot/byte-identity checks are now the standing gates —
`Dex-Test-Suite.html?full` (boots the ESM `GlucoDex.html`) + the equiv/golden legs + `verify-fixtures`.

**Phase 0 STOPPED here for the owner GO; the owner then approved Phase 1 (UI modules) and Phase 2 (DSP +
co-load bridge), both executed 2026-07-15 — see the parent brief.** Keep the finding, not the scaffold.
