<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: O2RING-AUTONOMOUS-HARVEST-2026-08-26-BRIEF.md
---
capture-host: the three O2Ring scan filters (`capture._connect_scan`, `pull_session._pull_once`, `probe_oxyii_ppg`) matched on configured address **or** a local-name hint, so any "O2Ring"/"Checkme O2"-named beacon in range could summon a GATT connect and a stored-session pull from the wrong ring; all three now delegate to `oxy_presence.is_expected_ring` (address only, the standing BLE-identity ruling) and the name is display metadata in a log line.
