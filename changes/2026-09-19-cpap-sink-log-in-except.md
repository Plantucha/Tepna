<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
The CPAP sink-failure log fired on every SUCCESSFUL write — `#2641`'s timing `finally` was inserted
between the `except` and its `_log.exception`, moving the log into the `finally`.

Measured on vigil 2026-09-19: **12,772 ERROR lines in 48 minutes** (~5/s, one per batch per sink)
reading `CPAP durable sink failed — counted (sink_errors=0), stream continues`, each followed by
`NoneType: None` because there was no exception to attach; the EDF was being written normally
throughout. A loud failure path that also fires on success is a silent one — the real error, when
it comes, is one line in fifteen thousand.

The log is back inside the `except`; the timing stays in the `finally` (a failing sink is still
timed, as #2641 intended). Plant: a clean two-batch stream must produce zero ERROR records while
still reporting `sink_errors: 0` and `sink_max_ms` — it fails on the regressed file with exactly the
two live lines.
