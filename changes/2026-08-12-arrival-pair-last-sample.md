<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: PAT-OFFSET-ESTIMATOR-FOLLOWUPS-2026-08-12-BRIEF.md
---
The arrival pairing used the FIRST sample in each packet; the arrival stamp follows the LAST one.

A BLE packet carries many samples and is delivered once, so `arrival - first_sensor_ns` charges every
delay with the packet's FILL duration — and that duration belongs to the stream's rate and frame size,
not to the link. Two streams of one device therefore disagreed by exactly the difference in their fill
times, while sharing one radio and one clock.

Measured on the first real night: the H10's fill times were 689.9 ms (acc) and 553.8 ms (ecg), a
136.1 ms difference, against a first-based offset spread of 135.1 ms — the anomaly WAS the fill term,
to within a millisecond. Pairing against `last_sensor_ns` collapses the same-device spread from
135.1 to 0.7 ms (H10) and 735.4 to 4.4 ms (Verity), and takes the Verity from certifying on NEITHER
stream to BOTH. The two devices are then on one host clock and differ by ~923 ms — the per-connection
inter-device offset `PAT-PACKET-ARRIVAL` §1 called unmeasurable. The ring is unaffected: its writer
passes the same value as both columns.

Also retires the canary's SMEARED arm, which fired on every stream of that night. `floor_ok` wanted
the minimum within 5 ms of the 1st percentile; true arrivals smear 29.3/42.0 ms (H10) and
155.1/590.6 ms (Verity), because BLE callback jitter is tens of milliseconds — the same order as the
back-timed stamps the sidecar replaced. It does not matter either: the H10 certified at agree=4.5 ms
despite a 42 ms smear. DEAD stays; it is the only thing that can see the swallowed exception, and it
stayed silent across all 159,607 rows. `floor_spread_ms` remains as a diagnostic.
