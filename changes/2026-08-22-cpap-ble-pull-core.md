<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: CPAP-BLE-CAPTURE-2026-08-21-BRIEF.md
---

**CPAP-over-BLE pull core — the ResMed AS11 link + spool state machine, clean-room from the published spec.**

Two pure, fully-covered capture-host modules that let the box pull therapy data off the AirSense 11 over
its encrypted BLE channel and stamp it with the box's stratum-1 clock (retiring the drifted-RTC SD harvest):

- `as11_link.py` — FIG framing, SRP-6a pairing math, session-key/proof derivation, and the read-only RPC
  builders (GetDateTime, StartSpool, PullSpoolFragments). Standard library only — no crypto dependency.
- `as11_pull.py` — the reconnect handshake and the StartSpool → PullSpoolFragments loop (fragment
  reassembly by `seq`, continuation via `nextSpoolAddress`, terminal-status handling), driven through
  injected `write`/`recv_frame` and an injected `seal`/`unseal` cipher so the whole machine is testable
  against a fake device with the standard library alone.

Written FROM the published protocol reference, clean-room, Apache-2.0 — not derived from the GPL
SomnoTrace. Read-only by construction: no write/therapy RPC is built anywhere. The real AES cipher and
bleak I/O live in an un-committed operator probe. 100 % statement+branch coverage.
