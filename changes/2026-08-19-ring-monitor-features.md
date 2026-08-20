---
bump: minor
type: added
brief: O2RING-OPCODE-SURFACE-2026-08-03-BRIEF.md
---

**Tonight's O2Ring capabilities reach the Vigil monitor: the ring's clock is WATCHED, its settings are
SETTABLE, and ppg2w gets a human name.**

- **RTC readback on the live link.** The oxyii session reads GET_INFO every 10 min (and on each
  session's first poll) and publishes `ring_rtc_offset_s` / `ring_rtc_read` to STATUS → `/api/state` →
  a "ring clock ±N s vs host" line on the monitor. The 6-hourly 0xC0 push was previously trusted blind;
  now a push that failed to land is VISIBLE. Verified live on deploy: the first-contact push fired and
  the readback confirmed it (offset 0.1 s), all automatic. An unset/out-of-range RTC publishes None —
  absence, never year-0 arithmetic (Clock Contract §2.7).
- **Monitor-set ring settings.** `POST /api/ring/config` (new, wired to `capture.queue_ring_config`)
  queues ONE whitelisted write — validation is `oxyii.set_config_frame`'s whitelist AT the HTTP
  boundary, so nothing invalid ever waits on a link, and an unwired daemon answers 501, never a hollow
  200. The live loop applies it and reads the struct back; the monitor's brightness (Low/Med/High) and
  vibration-intensity controls show the RING's read-back (`ring_config`) and the verdict
  (`applied` / `NOT applied — ring reports X` / `write failed`), never the value merely asked for.
  The settings struct is also read once per session so the controls show real values before any write.
- **Display rename**: the settings rows now read "raw 2-wavelength optical (ppg2w)", "oximetry (spo2)",
  "pleth waveform (ppg)" — the code/config/file key stays `ppg2w` everywhere (STREAM_LABEL is
  display-only). `oxyii_rtc_due`'s "the ring is WRITE-ONLY on time" docstring is corrected (falsified
  by the RTC readback); its write cadence deliberately keeps its shape.

Daemon-side: 7 new runner tests (offset math, applied/ignored/failed verdicts, unset-RTC honesty,
enqueue validation incl. last-click-wins). Web-side: `/api/state` contract extended by the four fields
(round-tripped with distinct values) + a 6-test endpoint contract. Deployed to the box and verified
live before landing. capture-host lane only.
