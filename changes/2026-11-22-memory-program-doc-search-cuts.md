---
bump: minor
type: added
brief: MEMORY-PROGRAM-2026-11-22-BRIEF.md
---
Add `tools/memory-program.mjs`, which classifies the fleet memory through the Batch API, and make each doc-search answer cheaper: a same-session repeat prints one line (`--again` runs it), passages stop at 400 characters, a refusal names three paths on one line, and each search logs its best score.
