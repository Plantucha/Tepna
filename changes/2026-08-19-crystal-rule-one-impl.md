---
bump: patch
type: fixed
brief: CROSS-DEVICE-DRIFT-FOLLOWUPS-2026-08-17-BRIEF.md
---

**The crystal rule was two copies. It is now one — and the consolidation exposed a latent bug that
would have silently disabled a gate.**

`CROSS-DEVICE-DRIFT-FOLLOWUPS` §Done-when asks that *"`dual-clock-rate.mjs`'s crystal rule reads
uncertainties, sharing ONE implementation with `device-stability.mjs`."* Both files exported their own
`MAX_CRYSTAL_SPREAD_PPM = 50`, and `device-stability.mjs`'s own comment says the bound *"must apply
here too or this tool re-prints the numbers that one rejects"* — a copy that knows it is a copy.

`dual-clock-rate.mjs` now imports `crystalVerdict` and delegates through a pure `crystalCoherence()`,
separated from the I/O for the same reason `classifyRate` is: so it is gateable on values rather than
by scanning a streaming loop.

**Behaviour is preserved exactly**, verified across six cases including both sides of the boundary
(`[0, 50]` → crystal, `[0, 50.1]` → not-a-crystal). The old predicate was `vals.length > 1 && spread >
MAX`; `crystalVerdict`'s `not-a-crystal` requires n ≥ 2 **and** spread > MAX. Identical by construction.

## 🔴 The latent bug: `device-stability.mjs` could not be imported at all

`:578` ran `pathToFileURL(process.argv[1])` **unguarded** at module scope. `argv[1]` is undefined under
`node -e`, `--eval`, a REPL and any embedding host, so importing the module threw `ERR_INVALID_ARG_TYPE`.

**That is worse than a crash, because of where it lands.** `tests/run-tests.mjs` wraps its tool imports
in `try { … } catch { return null }` — so a gate importing this module would have gone **silently to
SKIP rather than red**. The consolidation would have disabled the `dual-clock-rate` gate while every
suite still reported green. The sibling `dual-clock-rate.mjs:223` has always carried
`process.argv[1] &&`; this file never did, and nothing surfaced it until something tried to import it.

## Half the Done-when item is NOT satisfied, and that is recorded rather than claimed

It asks the rule to *"read uncertainties"*. It cannot yet: `dual-clock-rate.mjs` computes **no
per-fragment uncertainty at all** — no `ppmUncertainty`, `sigma` or `stderr` anywhere — while
`device-stability.mjs` sources its own from σ_y at the recording's own span, i.e. from Allan machinery
this tool does not run. So the shared verdict takes its **no-uncertainties branch** and falls back to
the raw bound, deliberately: that branch exists to refuse inventing a σ, and a fabricated error bar
would make every spread explicable. **Sharing the implementation lands now; reading uncertainties needs
σ_y computed here first and is a separate change.**

## The gate that keeps it one implementation

New group `tools · clock · crystal-single-source`, **14 assertions**: the bound is the same object, and
both entry points return the same verdict across eight inputs spanning the boundary and the corpus's
real extremes (`[-3035, -3030]` → crystal, `[-3035, 100]` → not). Plus anti-vacuity legs, without which
the group would pass if `crystalCoherence` returned a constant, and one asserting the **uncertainty
path itself**: `[{ppm:0, σ:40}, {ppm:90, σ:40}]` → **crystal**, a 90 ppm spread that is one clock once
judged through its error bars. That branch is unreachable from this tool today, so the assertion keeps
it covered and keeps the gap visible rather than silent.

*A shared implementation nobody checks is just a claim about the past.*

`npm run check` EXIT=0.
