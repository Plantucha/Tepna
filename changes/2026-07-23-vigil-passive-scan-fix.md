<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: VIGIL-DEEP-ANALYSIS-2026-07-22-BRIEF.md
---
Vigil O2Ring reconnect — passive scanning is now opportunistic, never a dependency (out-of-suite
capture-host/). The passive scan shipped hours earlier in the same brief's §4 took the O2Ring's reconnect
to ZERO: bleak's BlueZ backend only offers passive scanning through the AdvertisementMonitor API, which
needs `bluez={"or_patterns": [...]}` AND a bluetoothd started with --experimental, and where either is
missing it raises `BleakError('passive scanning mode requires bluez or_patterns')` at scanner
construction — instantly, before any scanning happens. Not a missed advert: a scan that never ran. Live
on the author's box every retry cycle logged a link error and the ring never reconnected, while the unit
tests stayed green because they stub `find_device_by_filter`, and a stub cannot refuse the way BlueZ does.
`_connect_scan` now tries passive once and, on a refusal from this stack, downgrades for the rest of the
process to the plain active scan `pull_session.py` has always used; a real scan failure (wedged adapter,
D-Bus NoReply) still propagates instead of being masked by a second scan on the same broken radio.
Verified live against the real adapter — passive refused, active connected, SpO2 flowing. 3 new pytest
cases, incl. a stub that refuses passive exactly as BlueZ does so this class of break cannot hide in the
tests again; 935 passing.
