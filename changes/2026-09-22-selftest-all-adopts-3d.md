---
bump: minor
type: added
brief: VERDICT-CONTRACT-2026-09-21-BRIEF.md
---

selftest-all.mjs is the second RUNNER to emit tepna.verdict/1 (VERDICT-CONTRACT §3d), through the same aggregateChildren as run-check: children are the per-tool selftests read from the summary line (a parsed count is PASS; green-but-unparseable is UNKNOWN, never a tool failure; a failing selftest is FAIL; a timeout is UNKNOWN; a near-miss tool is NOT_RUN and excluded), and the UNPARSEABLE_RATCHET is the runner's one criterion of its own. On the real sweep the object reads UNKNOWN over 121/121 — 26 ratcheted-unparseable children — where the prose says "all green". --json; the exit code is unchanged.
