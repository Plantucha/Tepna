<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: CPAP-BLE-CAPTURE-2026-08-21-BRIEF.md
---

**CPAP live-stream gate now blocks on ON-BODY sensors, not merely active streams — a charging/docked
device no longer refuses the stream.**

`cpap_stream.gate` refused whenever any non-CPAP stream was active. But a docked sensor reports
`connected=True` and keeps streaming (the O2Ring's motion channel while charging), so the gate became
unreachable exactly when a capture is SAFEST — the same 2026-07-26 docked-sensors bug
`cpap_harvest.blocking_devices` already fixed for the SD harvest. Observed live: the O2Ring charging on
its dock blocked "Start live stream" with `a sensor is on the body (O2Ring)`.

The fix single-sources the rule on `telemetry.on_body` (the canonical "a charging device cannot be on a
body" predicate): the gate now takes the daemon's device-status map and refuses only while a sensor is
`on_body is not False` (True OR unknown — the harvest's conservative policy, since a refusal costs only a
retry). The controller gains a `devices` provider (`() -> STATUS["devices"]`); `capture._build_cpap_controller`
wires it. Charging or disconnected sensors no longer block a CPAP stream. 100% coverage, mutation-clean.
