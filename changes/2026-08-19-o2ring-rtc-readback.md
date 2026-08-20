---
bump: minor
type: added
brief: O2RING-OPCODE-SURFACE-2026-08-03-BRIEF.md
---

**The O2Ring's RTC is READABLE — GET_INFO (0xE1) bytes [24:31] — falsifying the "push-only" model.**

Found on hardware 2026-08-19 by the differential double-read (`probe_rtc_read.py`): byte[30] advanced
by the gap mod 60 with byte[29] carrying; an absolute read 4 min after a 0xC0 push then matched the
freshly-synced host to the second. The layout is exactly `set_time_frame`'s write payload — year u16
LE, month, day, hour, minute, second, local civil, stored verbatim.

- `oxyii.parse_get_info` now decodes `rtc` (six components; None on any out-of-range component per
  Clock Contract §2.7 — an unset region reads as absence, never year-0 arithmetic). Round-trip
  gate-tested against `set_time_frame`.
- `probe_rtc_read.py --clock`: one read → ring RTC vs the NTP-disciplined host as a signed offset.
  Live: **ring +1 s vs host, 19 min after sync** — every 6-hourly 0xC0 push is now verifiable and
  free-run drift measurable per-interval, without pulling the onboard .dat.
- The full read surface is byte-mapped (13 reads × 10 s classifier) and recorded in
  O2RING-OPCODE-SURFACE §9: GET_INFO fully annotated (incl. a frozen 2016 date-year at [31:33],
  semantics unverified, and the wire serial 2592302100 ≠ the BLE-name id); GET_CONFIG all-const with
  motor=60 noted; GET_BATTERY[2] is an analog voltage-like channel, not a counter. §9 also records
  the 0x83 buzz-artifact characterisation (empty payload → ~1.1 s vibration, motion-channel detector,
  onset buffer-limited ±0.5 s).

capture-host lane only — no bundle, manifest, or fixture moves.
