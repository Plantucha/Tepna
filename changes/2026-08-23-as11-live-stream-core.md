<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: CPAP-BLE-CAPTURE-2026-08-21-BRIEF.md
---

**AS11 live-waveform capture core — `StartStream` builder + `StreamData` consumer, over the encrypted
BLE channel.**

The CPAP-over-BLE work so far pulled STORED spools; this adds the LIVE path the brief listed as a
follow-up. `as11_link.start_stream` builds the `StartStream` (0x13) request with validated params
(1–30 dataIds, sampleIntervalMs 10–65000, reportIntervalMs ≤ 5× sample). `as11_pull.stream` is an
async generator: it sends StartStream, verifies the device marked every requested dataId valid (a
partial accept raises rather than silently streaming a subset), then yields one decoded batch per
`StreamData` notification — `{stream_id, start_time, interval_ms, channels}`, merging the device's
list-of-one-key dicts into a channel map.

The `StreamData` wire shape is HARDWARE-CONFIRMED against a real AirSense 11 (2026-08-23): a
PatientFlow+MaskPressure stream at 40 ms delivered `StreamData` notifications of 5 samples each with a
per-batch device `startTime`. `start_time` is passed through verbatim — this layer never fabricates or
corrects a timestamp; the box's stratum-1 stamp is the correction, and the measured device offset
(+21.3 min) is the point of capturing it. There is no StopStream RPC: dropping the BLE link stops the
stream. READ-ONLY by construction — no write/therapy RPC anywhere.

100% statement+branch coverage; both new public functions are allowlisted in `find_unwired` (their only
consumer is the un-committed operator probe, same as the pull core). Validated live end-to-end with the
committed functions: 130 samples/channel captured over ~5 s. Live monitor rendering + daemon
integration are the next increment.
