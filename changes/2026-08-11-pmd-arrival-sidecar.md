---
bump: minor
type: added
brief: PAT-PACKET-ARRIVAL-2026-08-11-BRIEF.md
---

capture-host: a per-session `*_PMDARRIVAL.csv` sidecar recording the TRUE arrival instant of each PMD
packet beside the device timestamp of its first and last sample. The per-sample `phone` stamps in the
signal files are back-timed across each packet from one arrival, so `min(host − device)` has no floor to
find — measured, the minimum sits 27–115 ms below the 1st percentile. That is what defeats the NTP-style
estimator for the per-connection BLE buffering offset, which spans −867…+1321 ms between nights and caps
the usable PAT corpus at 2 site-nights of 10. Recording the raw arrival restores the floor.
