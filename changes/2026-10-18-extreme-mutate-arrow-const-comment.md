---
bump: patch
type: fixed
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---

The `extreme-mutate.mjs` selftest no longer calls its arrow-const blindness a limitation that it shares with `functionRange`. That peer resolves arrow consts since §8. The comment now states that any population this tool surveys, including §11's 543 functions, excludes every arrow const.
