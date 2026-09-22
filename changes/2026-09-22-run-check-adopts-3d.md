---
bump: minor
type: added
brief: VERDICT-CONTRACT-2026-09-21-BRIEF.md
---

run-check.mjs is the first RUNNER to emit tepna.verdict/1 (VERDICT-CONTRACT §3d): under --json, one object projected from ran/notRun/failedIdx and each step's exit code through the shared aggregateChildren (tools/verdict-emit.mjs) — population = the 18 steps, status by precedence (FAIL > SHORTFALL > UNKNOWN > PASS), an exit-code-only green child is UNKNOWN by provenance so a real run reads UNKNOWN until the steps adopt, a --steps= subset is filtered with the consumer rule stated in the object. The exit code is unchanged.
