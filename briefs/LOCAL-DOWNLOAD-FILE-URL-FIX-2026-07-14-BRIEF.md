<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-07-14 · **Created:** 2026-07-14

# Science tools must run from a local download (file://) — self-contained bundling

## The report
A user downloaded a "trio sigma" analysis tool (`sensor-trio-power-analysis.html`) to disk and it
"didn't want to work" — but it works when served from a server. Other science tools had the same
problem.

## Diagnosis (empirically confirmed with headless Chromium under file://)
The bundled **apps** (OxyDex.html, …) run fine from a download because they are single self-contained
files with **blob-URL workers**. The **science/analysis tools were never built that way** — each loaded
its logic from external `<script src="x.js">` siblings and spun workers with `new Worker('x.js')`. Under
`file://` the browser:
- refuses `new Worker('sensor-trio-worker.js')` → **`SecurityError: … cannot be accessed from origin
  'null'`** (opaque file origin) — so the worker pool ends up empty and the compute never runs;
- refuses `fetch('sibling')` → **`TypeError: Failed to fetch`** (the "load-by-path" data flow);
- and a user who downloads only the `.html` doesn't even have the sibling `.js` files.

So a downloaded tool loaded a shell that did nothing. (Verified: `new Worker('file.js')` throws under
`file://`; a **blob-URL worker runs fine** under `file://` + the no-network CSP — `worker-src blob:`.)

## The fix — `tools/build-analysis.mjs` (new)
Make each of the 9 tools self-contained single-file HTML, the way the apps already are:
1. **Inline** every external `<script src="x.js">` → `<script data-inline-src="x.js">…</script>` (the
   owned-bundler marker convention; idempotent re-fill from the current `.js`).
2. **Blob workers:** rewrite `new Worker('w.js')` → `__mkWorker('w.js')`, a factory that builds the
   worker from a `Blob`. Each worker's `importScripts` deps are inlined ahead of its body (importScripts
   can't load a file:// sibling from a blob either), behind a hoisted permissive **DOM/window shim** (the
   production DSP wrappers touch `window`/`document` at load; workers have neither — mirrors
   `cohort-worker.js`'s own shim). The cohort union loads cleanly (the Integrator already proves every
   node DSP coexists namespaced).
3. **CSP unchanged:** once inline, `default-src … 'unsafe-inline' … blob:` already covers inline scripts +
   blob workers (exactly what makes the apps work). The `fetch` "load-by-path" flow still can't run under
   file://, but every tool's PRIMARY input is drag-drop (FileReader), which works offline.

Verified with Playwright under **both** `file://` and `http://`: all 9 tools load with **zero** page
errors, and every worker completes its `{type:'init'}` → `{type:'ready'}` handshake.

## Gates (so it can't rot)
- **Staleness (CI, `tests.yml`):** `node tools/build-analysis.mjs --check` beside `build.mjs --check` —
  the tools inline DSP code, so a DSP edit that isn't re-bundled into the tools reds.
- **Invariant (Node suite, `dex-tests.js` group `analysis-tools · file-local`):** every tool HTML has NO
  external `<script src>` and NO `new Worker('file.js')` (blob workers only) — a regression that
  reintroduces the file://-hostile pattern reds. Node-lane only (fs-read `env.analysisTools`).

## Done when
- [x] all 9 tools self-contained; `build-analysis.mjs --check` clean.
- [x] Playwright file:// + http:// verification: 0 page errors, worker init→ready on all 8 worker tools.
- [x] staleness gate wired into CI; invariant gate green in the suite (2322+ / all groups).
- [x] re-run `tools/build-analysis.mjs` after editing any inlined `.js` or worker (the CI `--check`
      enforces this).

## Not done / notes
- The tools are **dev/research surfaces, not in the public `docs/` deploy** (no served twins), so no
  deploy sync. The `fetch` load-by-path flow is intentionally left degrading under file:// (drag-drop is
  the offline path). A future generalization could fold this into `tools/build-docs.mjs` if the tools
  ever join the deploy set.
