---
bump: patch
type: fixed
brief: SIGNAL-PATH-AUDIT-2026-08-20-BRIEF.md
---

**Audit F2: `oxyii.parse_get_info` accepted calendar-impossible RTC dates (Feb 31), and the consumer's
swallowed ValueError silently killed the ring-vs-host RTC telemetry.**

A #1543 regression: the RTC guard checked `1 <= d <= 31` per-field, so Feb 31 / Apr 31 / Feb 30 passed;
`ring_clock_offset_s` then threw `day is out of range for month` inside the BLE callback, which
swallowed it — the offset telemetry stopped publishing exactly in the battery-event scenario it exists
to catch. Fixed with a calendar round-trip via `datetime()` → `rtc=None` on ValueError (ported from the
correct sibling `polar_psftp.get_local_time`, per Clock Contract §2.7); the §2.7 test gains the
calendar-impossible cases the original missed plus a valid-date control.
