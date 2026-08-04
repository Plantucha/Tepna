<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: VIGIL-COEXISTENCE-AND-RANGE-2026-07-26-BRIEF.md
---

Re-measure `VIGIL-COEXISTENCE-AND-RANGE` section by section. No code work remains; it is
owner/hardware-gated, and was listed as actionable.

§2's Done-when is satisfied in code. `cpap_harvest.blocking_devices` refuses a harvest while any sensor
is actually STREAMING — refined since the brief was written, because `connected` alone was wrong: a
docked sensor reports connected while producing nothing, which made the gate unreachable on exactly the
evenings a pull is safest. And `due_now(now, at_hour, last_run_date, window_h=2)` confines the run to
`[at_hour, at_hour+2)` with `at_hour: 13`, so the nocturnal band is excluded by construction rather than
by a band check. Both gate the real call site.

§5 is resolved, measured on the live box. The brief recorded the installed udev rule as two fixes behind,
missing three vendor ids and the class catch-all; it is now byte-identical to the repo and carries all
five. The defence it exists for is in force: resolving each `hci` to its USB parent gives
`hci0 → 2357:0604 power/control=on` and `hci1 → 8087:0a2b power/control=on`.

Worth recording because it nearly produced a false finding: a naive sweep of
`/sys/bus/usb/devices/*/power/control` does return `auto`, for `usb1` and `usb2` — the USB root hubs,
not the dongle. Root hubs default to `auto`. Reading those as "the defence is off" would be the same
wrong-subject error §2 itself corrects for RSSI: a true measurement of the wrong thing.

What remains is two field re-measurements (§2's reconnect-delta re-run with sensors idle, §3's repeat
walk-away) and one owner decision (§4). Stays PROPOSED because those Done-whens are genuinely unmet —
not because work is queued.
