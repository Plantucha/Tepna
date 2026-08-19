---
bump: minor
type: added
---

**Pin the O2Ring's stored-session clock to host time — the sync we were missing, from collected data.**
`tools/o2ring-dat-timefit.mjs` fits the onboard `.dat` (RTC-stamped, free-running, ~+151 s drift) against
the live `SPO2.csv` (host-stamped on arrival). Both record SpO2/pulse/motion at 1 Hz from the same ring, so
the SpO2 series is a shared fingerprint: cross-correlate → the integer-second lag is `dat_clock − live`, and
the live side is already host time, so host time transfers onto every stored session.

Measured on two nights:

    2026-08-17: lag 413 s, mean |ΔSpO₂| 0.458 over 25,343 s
    2026-08-15: lag  44 s, mean |ΔSpO₂| 0.269 over 23,195 s

Both errors are **sub-quantum** (SpO2 is 1%-integer, so <0.5 mean abs error is essentially perfect
alignment). A RULER at 1 Hz: the ceiling is ±1 s (the .dat is second-quantised), 50× coarser than the
tap/buzz marker — but AUTOMATIC, RETROSPECTIVE, no hardware, runs on every night on disk.

⚠️ **The lag also quantifies the backup's extra coverage, which was the whole point of the onboard file:**
the .dat leads the live stream because it recorded before the BLE link connected. 08-15's .dat runs
29,313 s against the live 23,195 s — **~1.7 hours the live capture never saw**. The fit makes that concrete.

Byte layout physiology-verified 2026-08-19 (10-byte header, 3-byte records `[spo2 93–99, pulse 54–82,
motion 0–5]`, `0xFF 0xFF` trailer) — the framing was in trio-batch.mjs; the value decode is new here.

Selftest: 5 assertions incl. a planted-lag control (recovers +37 s and a different +10 s, so not
hard-coded) and a dropout control (zero-SpO2 gaps do not fake a match). Gate: `npm run test:tools`, biome
clean.
