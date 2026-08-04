---
bump: patch
type: test
brief: MUTATION-AUDIT-FINDINGS-2026-08-02
---

capture-host: kill the `_WORN_SINCE` grace-clock mutants in `run_polar`. The not-worn bookkeeping —
first-not-worn timestamp, only-set-if-absent so duty-cycle reconnects don't restart the clock, and
clear-on-rewear — had no test that could see it. Three tests over a driven HR session; verified by
re-applying each mutant.
