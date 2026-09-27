---
bump: minor
type: fixed
brief: none
---

A stream that arrives in bursts now says so instead of alternating LIVE / NO DATA. The ring's `o2pletha` frames arrive with a median gap of 1.98 s and a maximum of 33.27 s (measured 2026-09-26 23:00→05:00), so the shared 6 s event window called 1204 of 6762 gaps a stall — about 200 an hour, every hour — while three siblings on the same link and the same notification handler never crossed 3.1 s. `telemetry.stream_health` gains an optional pre-stated `quiet_s`: a stream registered with one reads `intermittent` with a why-text and only reads NO DATA after 90 s of real silence, the same figure the session-teardown watchdog uses. `quiet_s=None` is the default, so every other stream is judged exactly as before. The observed gap distribution is published beside the pre-stated figure as a diagnostic.
