---
bump: patch
type: fixed
brief: FINISHED-WORK-IMPROVEMENTS-2026-08-20-BRIEF.md
---

`tools/o2ring-dat-timefit.mjs` reported an unconverged search as a measured lag. `bestLag` returns
the argmin over a bounded window with no check that the winner is interior, so a minimum sitting on
an edge — meaning the real one is outside the window — was returned as `lagS: ±maxLag`. Measured on
a real pair: the pulse column returned 600 with `maxLag` 600.

Each leg now carries `atBoundary`, a pinned leg is excluded from both selection and the agreement
vote (two pinned legs would otherwise "agree" to 0 s), and both pinned is an explicit refusal naming
the remedy. Adds `converged` — two independent columns, both interior, agreeing — because `ok` alone
is not evidence: on the same real pair, widening 600 → 3600 flips which leg is pinned and moves the
chosen lag 400 s → 3581 s, both reported `ok`. A downstream hook must branch on `converged`.

Prerequisite for FINISHED-WORK §B4's hook. Analysis tool only; no shipped bundle changes.
