<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: changed
nodes: [capture-host]
brief: CPAP-AS11-BLE-WIRE-NOW-2026-09-07-BRIEF.md
---
The live CPAP stream's cost is MEASURED before any dataId is added (Unit 2 of the 2026-09-19 ruling;
`docs/AS11-STREAM-COST-2026-09-19.md`). From the box's 15 recorded sessions: 5.00 frames/s, 50
samples/s, 0.7–1.5 M samples a night, `overflow` 0 and `sink_errors` 0 on 15/15 — and one defect in
the record itself: `frames_ok ÷ malformed = 150.0` on every session, i.e. the device's 30 s HeartBeat
was classified MALFORMED and summed into `total_lost`, so the log reported 689–1023 "lost" frames per
night on a link that lost none.

- `cpap_ingest.FrameKind.NOTIFICATION` — a JSON-RPC notification the loop does not decode (HeartBeat)
  is counted as what it is, never as a loss; a frame with no method at all stays MALFORMED.
  `GapCounters.notifications` on the summary; `total_lost` unchanged in definition, now true in value.
- `GapCounters.bytes_wire` / `bytes_json` — what the link carried, counted in `as11_pull.stream` where
  the loop already touches the bytes (new `_read_frame` returns sizes; `_read_json` is its message-only
  view), over EVERY frame kind. The marginal cost of an id is `Δ(bytes_json / frames_ok)`.
- `_cpap_ble_connect` acquires the REAL ATT MTU after `start_notify` (the ring's idiom — bleak reports a
  placeholder 23 until then) and logs `link MTU=<n> (write step <n-3>)`; the write step follows it.
- `cpap.ble_stream.extra_data_ids` → `stream_to_bus(extra_ids=)` / `LiveStreamController(extra_ids=)`:
  ids requested in the SAME StartStream but PUBLISHED NOWHERE — no bus channel, no EDF channel — landing
  verbatim in the raw record and the byte counters. The daemon REFUSES the key without
  `raw_record_dir` (an unpublished id would otherwise be requested and dropped). First candidate
  `_LKF` (Leak, the quantity `_ZLE` gates); its unit is pinned from recorded values before a consumer
  exists. Default OFF; nothing armed on the box.

`GapCounters.summary()` gains `notifications`, `bytes_wire`, `bytes_json` (shape test updated, order
pinned). Not done: `Leak` in the detector's `POLL_ITEMS` (WU5) — the named box is answered by `_ZLE`'s
edge plus the stream series, not by one poll row at the sighting.
