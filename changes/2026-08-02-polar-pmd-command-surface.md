<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: POLAR-PMD-COMMAND-SURFACE-2026-08-02-BRIEF.md
---
The documented PMD command surface, swept on hardware and written down.

`POLAR-ONBOARD-BACKUP` §4a established the offline-recording bit by *reading* Polar's SDK. This is the
complement: what a real Verity Sense **answers** when asked every documented read-only question. New
tool `capture-host/probe_pmd_surface.py`; the findings live in the brief, and every claim there is
marked MEASURED / DOCUMENTED-UNTESTED / NOT-TRIED-deliberate.

**The clock finding is the one with teeth.** The device exposes two clocks and they are not the same
clock — the one it *answers about* (PS-FTP `GET_LOCAL_TIME`) and the one it *stamps samples with* (PMD
`sensor_ns`). Writing local civil time with the true offset is **accepted**, reads back **exactly as
written**, and the sample clock stays **UTC, 14415 s adrift**. A tool that sets the clock, reads it
back, sees what it wrote and reports success has verified nothing about the timestamps in the files it
is about to produce. Until now this lived only in a source comment from 2026-07-18; it is measured
again, from a different direction, and it is why `capture.py` puts every device on UTC.

**Op `0x04` says SDK mode is a substantially larger device** — PPG 28/44/55/135/**176** Hz against the
55 we use, ACC/GYRO to **416** Hz with selectable ranges — without entering it. Offline recording stays
capped at 13/26/52 Hz either way. Offered is not accepted; that is a separate experiment.

**The device advertises eight measurement types where Polar publishes five.** `0x09`/`0x0D` answer
`invalid_meas` and appear in no status list; **`0x0E` answers ok with no settings**, PPI's shape, and
appears in every list. What it carries is not established and the brief does not guess.

The probe enforces an **allowlist**, not a denylist: trigger writes `0x08`/`0x09` persist across power
cycles — an armed trigger records on every boot, consumes the flash budget and removes the live stream —
and an unknown opcode is assumed to write. The clock leg restores the daemon's UTC convention in a
`finally`, because leaving the armband on local civil time shifts every device stamp the next night by
the UTC offset, plausibly.

Four defects surfaced while building it, each costing a BLE window: DIS reads before the control-point
subscribe dropped the link (and reported the failure as a *string*, so it surfaced three frames later
as a bare `Not connected`); a refused write aborted the run instead of being recorded as the
measurement it is; the sweep's position lived in the Python stack, so a dead link meant starting over
rather than resuming; and `sweep_error` left the exit status at 0, so a run that collected nothing
reported success. An early draft of the brief also asserted a hard 4–9 write ceiling — a later window
completed all 36 commands on one link and disproved it before it shipped.

capture-host only, out of suite — no bundle, no `manifestHash` movement, no fixture re-recorded.
