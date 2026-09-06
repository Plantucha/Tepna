<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
A wedged CPAP adapter could not reach the rungs that would have fixed it.

The per-device wedge ladder ends at `_restart_radio()` under a 2/day budget. The rungs that fix an
RTL8761B-class wedge — power-cycle, `hciconfig reset`, `_usb_rebind` — live in `adapter_watchdog`,
whose escalation counter increments **only when a scan returns zero devices**:

    if n_seen == 0:      consecutive += 1     # the ONLY path that arms L2/L3
    elif n_seen > 0:     cycles = consecutive = 0

A radio deaf to one device still sees every other, so `consecutive` reset every round and those rungs
were unreachable. Measured 2026-09-04: `hci0` found the CPAP **0 times in 137 rounds** while
enumerating 107 then 81 other devices; the budget was spent, the log said so, and a manual
`tepna-btreset.sh` fixed it immediately. Every failover was a detection that was discarded.

Now, once the per-device budget is spent, the wedge hands off to the adapter ladder — **gated**,
because this rung re-enumerates a radio and firing it wrongly is worse than the fault:

* the pinned adapter must serve **nothing else live** — `instance_devices(cfg, adapter_mac)` scoped,
  not the loop's global device list, using the same `device_is_streaming` predicate as
  `classify_adapter_health` (extracted and single-sourced, so the two cannot drift into disagreeing
  about what "live" means and then power-cycle a working radio);
* the USB bus-port is **derived from the adapter's own MAC** via sysfs (`adapter_usb_id`), never from
  `watchdog.usb_path` — that static value names one radio for the whole box, and on vigil it was
  `1-2` (the UB500) while the watchdog watched the Sena on `1-5`;
* no derivable path ⇒ **refuse the rung and say so**; a fallback is how the wrong-radio rebind
  re-enters;
* **one handoff per day**, since the branch runs on every poll once the budget is spent.

Tested against vigil's real config shape — no `adapters:` map, no per-device pin, the CPAP absent from
`devices:` and pinned under `cpap.ble_stream.adapter` — because a synthetic `devices:`-entry fixture
never exercises that path, and the row exists precisely because a configured rung proved unreachable
in practice.

Three defects in this work were caught by the gates rather than by review: `find_unwired` found the
gate defined and never called; wiring it surfaced a `notifier` NameError on the one path that runs
only during an incident; and the 100% coverage floor found both an unreachable exception handler left
by the refactor and a **vacuous test of my own** — `_stop_after(n)` counts sleep calls, not polls, so
the one-per-day bound was never actually exercised.
