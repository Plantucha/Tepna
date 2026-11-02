---
bump: patch
type: fixed
brief: none
---
`tools/trio-batch.mjs` states the child heap cap as the one constant it has always answered. `childHeapMB` read `Math.max(CHILD_HEAP_MB, Math.min(CHILD_HEAP_MB, perJobMB))`, and one identifier stood in both bounds. So the per-job figure it derived reached no consumer, and two comments described a clamp that could not bind. Behaviour stays byte-identical on every live path. A plan carrying a non-numeric `budgetGB` no longer propagates `NaN` into a child's `--max-old-space-size`.
