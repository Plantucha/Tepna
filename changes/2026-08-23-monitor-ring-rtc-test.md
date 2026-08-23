<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [capture-host]
brief: none
---
Add `tests/test_monitor_ring_rtc_alarm.py` — the dynamic complement to `find_unwired` for the ring RTC-reset alarm. `find_unwired` proves `ring_rtc_reset_suspect` is drawn by something; this EXECUTES the shipped `renderRingRtc` under node (test_monitor_escaping.py's extract-and-run pattern) and proves it draws the RIGHT thing: renders `#ring-rtc-alarm` with the stamp when the flag is an active ISO string, renders NOTHING when null/absent/false (no fabricated dash), and entity-encodes a hostile stamp before innerHTML.
