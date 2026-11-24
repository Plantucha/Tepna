---
bump: minor
type: changed
brief: MEMORY-PROGRAM-2026-11-22-BRIEF.md
---

`tools/memory-program.mjs` now redacts tailnet addresses (RFC 6598) before text leaves the rig. Hybrid
doc-search blends the reranker order with the fused order, and it prints at most three memory notes after the
five hits. The memory program brief records steps C, D and E.
