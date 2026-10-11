---
bump: minor
type: added
brief: INTEGRATOR-SURFACE-2026-10-11-BRIEF.md
---

**Every Integrator key declares whether it reaches a card or only the export.**

`cvhrCorroboration` was computed, exported, asserted — and rendered by nothing. That may be correct;
what was wrong is that nobody had said so, which made an unrendered key and a forgotten key identical.

`tools/integrator-surface.json` now declares `card` or `export-only` for every key the fusion emits,
and `tools/integrator-surface-gate.mjs` reds on exactly two conditions: an undeclared key, and a
`card` key with no mention in `integrator-render.js`. Measured: **25 keys — 14 card, 11 export-only,
0 undeclared.** Closes residue `2026-09-29-integrator-cvhr-corroboration-is-export-only-and-unrendered`.

⚠️ The declarations were seeded from a render scan, so the first PASS is true by construction — the
brief's §4 says so rather than letting it read as evidence. What the gate detects is drift: a new
undeclared key, or a `card` key whose render mention is deleted. Both are planted in `--selftest`.

The gate enumerates from **source**, not from `uploads/` fixtures: the briefed 108-key count is
reproducible (110 keys, 49 unrendered, at depth ≤ 2 unioned over the fusion fixtures) but unusable,
because that scan finds one fixture in a worktree and in CI and would report a clean pass over almost
nothing examined.
