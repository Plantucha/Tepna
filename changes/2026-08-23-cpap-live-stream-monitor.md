<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: CPAP-BLE-CAPTURE-2026-08-21-BRIEF.md
---

**CPAP live waveform in the monitor — flow + pressure over BLE, onto the Live-streams grid.**

Stage 2 of the "cipher into the daemon" path: the daemon now runs the ResMed AS11 encrypted stream and
pushes it onto the SAME telemetry bus the wearables use, so the existing SSE endpoint + renderer draw a
live CPAP flow/pressure trace with no new feed or UI plumbing.

- `cpap_stream.py` — `stream_to_bus` (establish → `as11_pull.stream` → `bus.register`/`bus.push` per
  batch, cipher injectable for tests), `gate` (refuses while any wearable is delivering — a BLE stream
  must not transmit beside the sensors), and `LiveStreamController` (start/stop lifecycle: gate, creds,
  task, clean teardown).
- `webmon.py` — `POST /api/cpap/stream {action:"start"|"stop"}`, injected `cpap_stream` op (same seam as
  `cpap_pair`): 501 when unwired, a gated refusal passed through as an ok:false 200, exceptions → 500
  that never crash the monitor.
- `capture.py` — wires the controller into `make_app` on the free radio (hci1 by default); the only
  un-unit-tested code is the bleak connect edge (pragma'd, validated live). `_load_as11_creds` returns
  None for a missing/malformed/incomplete file so the controller refuses cleanly.
- `monitor.html` — a "Start/Stop live stream" button on the CPAP card; the waveform appears in the
  Overview grid via the existing bus→SSE→render path.

Read-only by construction (StartStream is an `application` read; no therapy RPC anywhere). New modules at
100% coverage, mutation-clean; the daemon wiring is covered by the existing `main()` tests.
