---
bump: patch
type: added
brief: GENERATED-OUT-OF-PRS-2026-10-20-BRIEF.md
---

The PR compliance gate names each build output in a PR diff as an advisory. The list comes from `rebase-safe.mjs --build-outputs`, which leaves out provenance and regen fixtures. The walker's regeneration branch is exempt. This is stage 2 of the plan to take generated files out of pull requests.
