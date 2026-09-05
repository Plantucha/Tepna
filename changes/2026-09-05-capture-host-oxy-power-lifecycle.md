<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: O2RING-POWER-AWARE-BLE-LIFECYCLE-2026-09-05-BRIEF.md
---
The O2Ring acquisition path gains a fourth axis — **POWER** (`oxy_power.py`) — beside LINK, RECORDING and
PRESENCE: twelve explicit radio states, a named owner for every second the radio is on, and the rules for
when a harvest may spend it.

What changes behaviourally on the box:

- **The presence observer no longer scans at a 50 % duty cycle all night.** It slept `window_s` after a
  `window_s` window regardless of what it saw. It now picks the next pause from the ring's power state:
  8 % duty while every ring is absent, 17 % while one is present, 50 % only while the RECORDING axis says a
  session is closing. It also scans PASSIVE first (listen only, no scan requests) on the same opportunistic
  flag `_connect_scan` already used, falling back to active on the stack's first refusal.
- **The automatic pull pollers are gated.** Charger / doff / presence and the hourly net ask the engine
  first: a ring in a failure-typed backoff or a three-strike cooldown is not connected to again, a ring
  streaming live PPG is never interrupted for a download, and an idle already synced waits for the
  WORN→RECORDING→REMOVED chain (event triggers only — the hourly net deliberately ignores that last veto,
  because a night with no link never observes the chain and raw data outranks battery). The veto lands
  BEFORE any `_*_PULLED` latch is spent, so a deferred trigger is still armed when it lifts. The manual
  API pull is ungated.
- **A failed hourly connect no longer reconnects at once.** `autopull_poller` retried a failed attempt
  immediately, `retries` times per cycle; the failure is now a strike with a backoff typed by its cause
  (60 s transport … 3600 s protocol/auth), doubling per strike, three strikes → 30 min of silence.
- **The restart-storm hold is journaled as a COOLDOWN** with its deadline, once per deadline; its own
  protection is unchanged.
- `pull_session` passes bleak's connect timeout explicitly (`TIMEOUTS.connect_s` = the same 30 s), so all
  seven phase bounds are declared numbers.
- `webmon /state` forwards `power[name]` — state, radio owner, scan policy, per-ring cache, and counters
  (scan/connection/harvest seconds, files, bytes, strikes, cooldowns, deferrals by class).

Not changed, deliberately: no `stop_notify` on teardown (non-bonded peer; the CCCD resets on disconnect),
no persistent cache file (the OXYLIFE journal is the durable record), and `pull_session`'s phase order,
which already was the task's SAFE→CONNECT→IDENTIFY→INVENTORY→DOWNLOAD→VERIFY→COMMIT→DISCONNECT.

Pinned by 55 engine assertions (30 adversarial state-machine cases) and 18 wiring cases against the real
`capture.py` pollers. Unproven until the ring is on the bench: passive-scan acceptance by vigil's BlueZ, and
the night-long power budget (the brief's §4).
