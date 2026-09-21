<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: O2RING-POWER-AWARE-BLE-LIFECYCLE-2026-09-05-BRIEF.md
---
`OXYLIFE.csv` — the O2Ring lifecycle journal every connect-yield number in the residue ledger rests
on — was being WIPED on every daemon restart. `OxyLifeLogWriter` opened the night's one fixed file
with mode `w`; the daemon restarts ~11–15 times a day (every deploy), so each night's file kept only
its last process's rows. Found while re-measuring `2026-09-06-ring-connect-attempts-mostly-fail`:
the journal for 2026-09-10 holds ~250 ring connect attempts (~18/h, 05h–19h) against 21 in that
night's `OXYLIFE.csv`, whose rows span one process window; the 2026-09-19 file starts at 05:55 UTC —
the night before it is gone. Now `"a"` when the file is non-empty, preamble + header only when fresh
(`resumed`, the `SessionSidecar`/`ClockSidecar` rule), two tests.

Consequences, recorded rather than implied: the 09-06 row (1216 attempts, 31.5 %), the 09-10 row
(18 nights, median 8.2 %) and my own round-3 stamp on the power brief ("15 nights of power rows")
were all computed over the surviving fraction; the lost rows are unrecoverable. The classification
the 09-06 row asked for is in production since #2377 (385/386 connect-failed rows carry a
`failure` class: `device_unavailable` 336 · `transport_failure` 46 · `timeout` 3), so that row
closes `fixed #2377`; the 09-10 row's remaining ask — a denominator of attempts that should have
succeeded — becomes computable only after a week of un-truncated files. New residue row
`2026-09-20-oxylife-truncated-on-every-restart`. From the journal, the three real populations:
`BleakDeviceNotFoundError` (daytime, ring away — benign) · `org.bluez.Error.InProgress` (contended
adapter) · connected-but-`no OP_AUTH reply`, which is NOT a failure (the session continues into a
pull). Nothing armed on the box.
