<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: ZEPHYR-INSTRUMENT-2026-08-23-BRIEF.md
---
The BLE delivery-jitter instrument (brief §Task 2): tools/ble-jitter-probe.py parses btmon text
and reports per-device advertising base interval, folded residual jitter (missed beacons removed
via the _wrappedSlopeFit modulo trick), miss rate and RSSI — with a selftest that plants all three
failure mechanisms its first night hit (btmon per-event address echo; active-scan SCAN_RSP
siblings a few hundred microseconds after each advertisement; the degenerate small-base fold that
absolute-residual scoring hands the win to). First measurement, vigil 2026-08-23: host-stack
delivery-jitter floor ~= 4.5-6 ms on BOTH the Realtek and Zephyr adapters — adapter-independent,
above hostAxis's 2 ms independence quantum, below the 30/45 ms connection-interval quanta, so the
Clock Contract's existing model survives measurement. Next layers (brief): nightly capture-host
sampling, then an additive hostAxis stackJitterMs diagnostic.
