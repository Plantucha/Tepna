---
bump: minor
type: added
brief: VERDICT-CONTRACT-2026-09-21-BRIEF.md
---

The test runner emits tepna.verdict/1 (VERDICT-CONTRACT §3d, the third runner): tests/run-tests.mjs --json carries a `verdict` (a superset of the shape verify-shard-union reads) built by tools/run-tests-verdict.mjs through the shared aggregateChildren — a group is a child, an assertion is not; --group= and --shard= are declared exclusions (filtered, with the consumer rule); an undeclared skip is FAIL by the skip budget; the --jobs union aggregates the shard objects, so a dead shard is an undeclared NOT_RUN and the union is UNKNOWN, never a pass over the shards that finished. The human lane prints the object's one-line reading; the exit code is unchanged.
