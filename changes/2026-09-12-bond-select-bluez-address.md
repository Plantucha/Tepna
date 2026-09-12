<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
**A pinned Zephyr HCI dongle was bonded, forgotten and power-cycled on the WRONG radio.** The dongle
carries two addresses — the kernel's (`hciconfig`, what an operator reads and pins as `adapter:`) and
the static-random identity BlueZ assigned it (`bluetoothctl list`). `bluetoothctl select <kernel
address>` prints `Controller … not available`, exits 0, and carries on on the DEFAULT controller —
measured 2026-09-12 on a four-radio box: every `select` aimed at hci0's dongle ran on hci3's. bleak
never saw it (it takes `hciN`, resolved from the kernel address just fine), so the capture path and the
bond path were addressing two different radios all night.

- `bonding.bluez_address` resolves the configured adapter to the address BlueZ lists — as-is when
  listed, else kernel address → hciN → BlueZ identity of that hciN (`link_rssi.dbus_hci` /
  `resolve_hci`). Unresolvable ⇒ the configured value passes through with a WARNING, so the failure
  stays visible in the transcript instead of turning into a strap that never bonds. Every bluetoothctl
  session — scan (and its per-device `info` enrichment, unselected until now), bond, is_bonded,
  trusted_flags, forget, and the watchdog's power-cycle at all three `select` sites — goes through it.
- `list_adapters` runs plain `hciconfig`, not `-a`: `-a` issues the BR/EDR `Read Local Name` per
  controller and aborts the listing on the first failure, which an LE-only controller returns as I/O
  error 5 — so on the same box it listed ONE of four controllers and the failover rung had no spare.
- Tests: the resolver's four outcomes; all five entry points and the watchdog driven with a stubbed
  BlueZ view, asserting the resolved address and never the configured one; `list_adapters` argv.
