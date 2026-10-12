---
name: rebundle-and-gate
description: Use when a change touches any *-dsp.js, *-render.js, *-app.js, *-cross.js, a *.src.html or a shared spine module and the bundle must be rebuilt — gives the load-bearing order of typecheck, lint, build.mjs, npm run check, golden regen and verify-fixtures. Use before committing a bundle change, and when a provenance or fixture gate reds after a rebuild.
---

# Re-bundle and gate, in order

The order is load-bearing; the rationale is `CLAUDE.md` §🔏 and its re-bundle checklist.

1. `npm run typecheck && npm run lint` — **before** building. A reflow after `build.mjs` moves
   `manifestHash` and re-runs the whole chain.
2. `node tools/build.mjs --app <App>` for **every** bundle carrying the file. A DSP inlined into
   `OverDex.html` / `Data Unifier.html` means those too: `grep -lc 'data-inline-src="<file>"' *.html`.
3. `npm run check` — the FULL gate. Never `build.mjs --check` alone, never a hand-picked subset of the
   four generated trees.
4. **Regen goldens LAST**: `node tools/regen-<node>-goldens.mjs`.
5. `node tools/verify-fixtures.mjs` when the compute closure moved. There is no per-node mode, and
   `--node` was never a flag — the tool now refuses an unread token instead of running the whole suite.

## Measured

Step 4's position cost two full chains in one night: regen stamps the current hash, so a rebuild
after it stalens every fixture it just wrote. Step 3's scope cost a CI red when
`treatment-response-analysis.html` was left off a staging list — `npm run check` covers all four
generated trees and a subset misses one.

A DSP edit also moves pinned analysis closures: `oxydex-dsp.js` changes each cost a 22-minute
`analysis-rerun` to re-measure the treatment-response yield pin (four separate times on 2026-10-11).
Budget that before starting, or batch the units.

Memory: `shared-module-change-rebundles-every-tool`, `invoke-a-gate-the-way-the-gate-invokes-it`.
