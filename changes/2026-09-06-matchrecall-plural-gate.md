---
bump: patch
type: fixed
nodes: [suite]
brief: DEEP-AUDIT-VI-FOLLOWUPS-2026-09-02-BRIEF.md
---

The matchRecall cross-site gate no longer requires the duplication it exists to police.

It asserted `_crSeen.length === 2` and ran its body only when exactly two implementations were found —
so single-sourcing `matchRecall`, which is the fix the repo wants, would have reddened it. The count
conflated lane coverage (every listed file is in env.sources) with copy count; separating them lets one
copy pass, while every property still has to hold in EVERY implementation found.
