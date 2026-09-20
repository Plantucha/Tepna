<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: CPAP-AS11-BLE-WIRE-NOW-2026-09-07-BRIEF.md
---
The AS11's OWN session-boundary witness, recorded beside the live stream (WU4 core; owner "implement
it all, just better", 2026-09-19). T1 that day established that the box had ONE witness for "therapy
started": `auto_start` fires on the shadow detector's own `Therapy` sighting (0 detector rows during
the stream on 11/11 sessions), so detector and trigger cannot disagree. `SubscribeEvent` gives a
second one the device pushes itself.

`as11_link.subscribe_event(data_ids, rpc_id=17)` — the READ-ONLY JSON-RPC (nothing is set).
`as11_pull.stream(..., subscribe=, on_event=, on_subscribed=)` sends it BEFORE `StartStream`
(ordering contract: awaiting its ack can never consume a waveform batch) with a bounded 10 s wait;
a device error or timeout is RECORDED (`failed:<Exception>`) and the stream proceeds — a night is not
lost to a declined witness. `cpap_ingest.FrameKind.EVENT` + `GapCounters.events`: an
`EventNotification` is its own kind, counted apart from `malformed`, never in `total_lost`, routed to
the recorder and never yielded as a batch. New `cpap_events.py`: `parse_event_notification` (pure,
never raises, never fabricates — a bool never reads as `_ZLE=1`, a non-string `reportTime` is None);
`EventRecorder` writes every notification VERBATIM to a host-stamped JSONL sidecar
(`cpap-events-<UTC>.jsonl` beside the raw record / EDF), tracks `_ZLE` — the first value is a LEVEL,
not an edge; rising = FIRST edge, falling = LAST — and the trigger's own start/stop marks, and reports
`witness_start_delta_s` / `witness_stop_delta_s` (None over a missing edge, never 0, §∅). The snapshot
rides the gap-accounting log line (the surface live on the box) and `provenance.events` of the
acquisition envelope. `LiveStreamController(events_factory=)` builds one recorder per session;
`_build_cpap_controller` wires it ONLY under `cpap.ble_stream.events.enabled` (default `false`,
documented in `config.example.yaml` — a change in what the radio carries beside a sleeping body is the
owner's edit, never shipped code). Default ids `UsageEvents-TherapyStatusEvents` + `_ZLE`, each with a
named consumer; add one only with its consumer.

Does NOT replace `auto_start`/`auto_stop`: it records when they and the device disagree. Ships COLD;
nothing armed on the box. `GapCounters.summary()` gains the `events` key (shape test updated).
