---
name: spine-module-realm-sweep
description: Use when a change touches a module inlined into more than one place — enumerates every realm that must carry a symbol from it: the manifest bundles, the orchestrators, the analysis tools' vm realms, DEX_COLOAD.shared, and cohort-worker.js's own SCRIPTS table. Use before committing a shared-module change, and when a built page times out instead of throwing.
---

# Sweep every realm a shared module reaches

Authority: `CLAUDE.md` §👥.3 (which bundles carry which spine module) and §🔏.

- **Enumerate, never assume.** Bundles: `grep -lc 'data-inline-src="<file>"' *.html`. The analysis
  tools' vm realms: the builder's own list in `tools/build-analysis.mjs`. Co-load:
  `DEX_COLOAD.shared` in `dex-coload.js`. Worker `importScripts` lists. And
  **`cohort-worker.js`'s own `SCRIPTS` table** — one realm kind per literal.
- **A realm list is a list of FILES, not a dependency graph.** Adding the file that *calls* a symbol
  does not add the file that *defines* it; nothing resolves it for you inside a blob worker.
- Rebuild the tools (`node tools/build-analysis.mjs`) and check with `npm run verify:analysis`.
  `npm run check` boots no worker, so a green gate does not mean a realm evaluates.
- **Say in the PR body which realms you checked and how you enumerated them** — a sweep whose
  population came from a `grep` of one directory is a sweep of that directory.

## Measured

The five realm kinds were found one at a time, each by a failure: bundles #3426 · six tool vm realms
#3437 · `DEX_COLOAD.shared` plus a test worker #3443 · `cohort-worker.js`'s `SCRIPTS` table #3462.
#3443's own commit says it "audited EVERY file that loads a profile module rather than fixing the one
CI named" — and missed the fifth. The residue row measured the population as six by grepping `tools/`;
it is seven.

**A break in a worker realm presents as a TIMEOUT, not a throw.** The blob worker dies during
`importScripts`, before any job runs, so the caller waits out its budget (`window.TREATMENT_RESPONSE
never appeared within 5 min`) and the failure looks like slowness. Probe the built page's `__WSRC`
instead: `new Function(src)()` with `importScripts` stubbed names the `ReferenceError` in under a
second, against 22 minutes for the real run.

Memory: `a-realm-list-break-presents-as-a-timeout`, `shared-module-change-rebundles-every-tool`.
