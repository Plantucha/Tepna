---
bump: minor
type: added
brief: LOCAL-QWEN-SWEEPS-2026-11-22-BRIEF.md
---
Add `tools/compute-feeder.mjs` and `tools/qwen-lead-check.mjs`. The feeder supplies the two consumers that cost no Claude tokens. It asks the local model one lens question per site and checks each lead mechanically. It keeps 6 h of tasks in the Shrike queue and 48 h in a reserve for when the fleet runs out of tokens. Stage 6 of `tools/qwen-idle-driver.sh` runs it each cycle. `tools/qwen-agent.mjs` now finds its CLAUDE.md markers without regard to case and reports a marker that is absent.
