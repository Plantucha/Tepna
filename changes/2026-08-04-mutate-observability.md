---
bump: patch
type: fixed
brief: TEST-COVERAGE-FOLLOWUPS-II-2026-07-17-BRIEF.md
---

Three defects in the mutation tooling, all found by running it on a real 127-mutant sweep rather than by
reading it: `--report` silently found nothing on a run carrying 34 survivors (it assumed a `{files:[…]}`
wrapper; `mutate.mjs --json` emits NDJSON), the worker-pool build printed nothing so setup was
indistinguishable from a hang, and the ETA divided by cumulative elapsed so its first sample carried the
whole pool build and projected 644 min for a run that took 80.
