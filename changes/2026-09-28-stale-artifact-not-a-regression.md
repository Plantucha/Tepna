---
bump: patch
type: fixed
brief: MUTATION-SURVIVOR-LEDGER-2026-09-28-BRIEF.md
---

The survivor ledger stops calling a stale artifact a regression. Ingest places a run against each closure using the commit every `tepna.verdict/1` already carries: a verdict whose code does not contain the closing commit reads NOT_APPLICABLE with both shas named, one that does and still shows the mutant surviving is the real regression and the only thing that reds, and a verdict that does not say which code it judged refuses with NOT_RUN rather than assuming the current one. The closing commit is resolved from the closing PR's number so it survives a squash merge, which a recorded branch sha does not.
