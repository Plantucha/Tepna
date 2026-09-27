---
bump: patch
type: fixed
brief: none
---

Eight capture-host tests that named a behaviour and asserted nothing now assert it. The watchdog and poller pause-skips are observed on the probe, re-sync or radio read they must NOT make (each with an unpaused positive control); the power-cycle cap is counted on the `power off` commands sent and the give-up line's level (ERROR, not the CRITICAL the docstrings claimed); the three clock-watchdog error arms are told apart by the CLOCKSYNC verdict and log line each one emits; flush-on-every-write is counted on `flush()`; a failing distress scan is shown to cost the watchdog nothing by a second poll that still probes BlueZ; and the charger-poller early return is bounded by `wait_for` with a sentinel sleep instead of hanging the suite on regression. One test is renamed to what it can show: a malformed connect contract raises the real error, not NameError, and the never-bound disconnect is not invented. Found by `audits/CAPTURE-HOST-TEST-DRIFT-CENSUS-2026-09-25.md`.
