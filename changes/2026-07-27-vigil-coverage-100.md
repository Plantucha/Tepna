<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [capture-host]
brief: none
---
Take capture-host to 100% statement AND branch coverage and raise the CI floor from 48 to 100. The floor was 49 points below the tree's real 97%, so coverage could have cratered with CI green; branch mode was off, so a taken-one-way `if` counted as covered; and `deploy/ezparse.py` was untested AND absent from the denominator entirely (coverage's unexecuted-file scan skips non-importable subdirectories, so it read as no debt). 99 new tests close what was missing — the frozen-sensor alert, the retention hold that stops a broken backup volume eating the only copies, the on-charger auto-pull, `_adapter_is_up`, the archive push and its verified-only marker, four `BAD_BODY` guards, and every fail-safe OSError arm in the mirror checks. Fourteen inline `pragma` exemptions each carry a proof of unreachability; one of them documents dead code in `cpap_harvest.harvest` (`fetch`'s `was_short` is unconditionally False — the same predicate already raised `ShortRead`).
