---
bump: minor
type: added
brief: O2RING-OPCODE-SURFACE-2026-08-03-BRIEF.md
---

**The ring's clock gets a history, a reset alarm, and a battery channel: the `_RTCLOG.csv` sidecar.**

The RTC readback (#1543/#1548) published only the LATEST offset to STATUS and forgot the rest — but the
crystal is a clock this suite characterises (allan.py), a 0xC0 push is a claim until a readback
confirms it, and a battery-event RTC reset silently ruins a stored .dat's timebase. `RingClockLogWriter`
records the history: one row per event — `read` (the ~10-min readback with its offset), `push` (the
0xC0 claim; the next read is its verification), `reset-suspect`, `battery`.

- **RTC-reset detection**: |Δoffset| > 5 s between reads (quantum ±1 s; 10-min drift ≪ 1 s) flags a
  battery-event reset the moment it is SEEN — `ring_rtc_reset_suspect` on /api/state, a WARNING naming
  the jump, a sidecar row, and the re-push queued immediately (clearing `_OXYII_RTC_AT` puts the next
  loop in first-contact state). The previous behaviour: invisible until a .dat fit failed. Tracked
  per-address ACROSS reconnects, because battery swaps happen while disconnected.
- **Battery channel**: a 0xE4 poll rides the 10-min info cadence; `battery_raw2` (the analog
  voltage-like byte mapped 2026-08-19) is logged raw — the log IS its characterisation — and `raw3`
  (constant 0x10 so far) is logged so a firmware where it moves is caught by data.
- The sidecar keeps LinkLogWriter's disciplines: a sidecar never a vendor-layout column, telemetry
  never a ganglior metric, blanks never fabricated zeros (each gate-tested).

Runner tests: sidecar rows (push/read/battery with the analog byte round-tripped), the jump →
reset-suspect + re-push path, and the 1 s-drift DENY twin. Writer unit tests: header + blank
discipline, guarded double-close, flush cadence. Deployed live to the box. capture-host lane only.
