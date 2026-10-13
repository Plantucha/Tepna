---
bump: patch
type: added
brief: AHI-SURROGATE-REFIT-SIZING-2026-10-12-BRIEF.md
---

Name the scoring pool's hold-out order. `--seed` sets it, and the old literal is the default.
Every run made before this change reproduces. A resume under a different order refuses.
The checkpoint and the results file each name the order the run used.
