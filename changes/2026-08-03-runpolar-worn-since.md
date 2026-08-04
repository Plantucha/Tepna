<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [capture-host]
brief: none
---

capture-host: kill the `_WORN_SINCE` grace-clock mutants in `run_polar`. The not-worn bookkeeping —
first-not-worn timestamp, only-set-if-absent so the duty-cycle reconnects don't restart the clock, and
clear-on-rewear — had no test that could observe it. Three tests over a driven HR session, each
verified by re-applying the mutant rather than by reading the code.
