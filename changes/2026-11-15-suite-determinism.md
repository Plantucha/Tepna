---
bump: patch
type: added
brief: JS-MUTATION-LANE-CI-COST-2026-10-20-BRIEF.md
---

Add `tools/suite-determinism.mjs`. The tool runs one test selector repeatedly over an unchanged tree. It reds when the result sets disagree, and it reads NOT_RUN when the selector matched no group. `boundedChild` now carries a failing child's partial output, because a reader that discards it turns every failure into one empty answer.
