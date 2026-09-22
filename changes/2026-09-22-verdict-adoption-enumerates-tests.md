---
bump: patch
type: changed
brief: VERDICT-CONTRACT-2026-09-21-BRIEF.md
---

The verdict-adoption gate enumerates tests/*.mjs (non-recursive) alongside tools/*.mjs and capture-host/*.py — the test runner had adopted §3d from outside the population. tests/run-tests.mjs gets its own adopted row (emits.cmd = a real, corpus-free --group=docs-ledger --json run; the object is picked from the payload by the new emits.key); the five other tests/ producers are binned honestly (four runners/gates pending, one test file exempt).
