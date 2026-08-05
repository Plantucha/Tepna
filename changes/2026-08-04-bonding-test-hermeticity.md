<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: CAPTURE-HOST-MUTATION-FLEET-2026-08-04-BRIEF.md
---

Two `test_bonding.py` tests stubbed only `_delayed_script` and left `_btctl` live, so `scan()`'s `info`
enrichment loop reached the real `bluetoothctl` — green on a box that has BlueZ, red on the CI runner.
They now use the `_stub()` helper (which patches both entries) and assert what that loop does, and an
autouse fixture makes any unstubbed `create_subprocess_exec` in the file fail with the cause named.

Also covers `mutation_triage.concentration()`, which shipped untested in the same commit as the brief
that ranks the fleet by it; one test pins its known per-function granularity defect.
