---
bump: minor
type: added
brief: SOLID-NIGHT-2026-09-23-BRIEF.md
---

capture-host: the SOLID-NIGHT verdict runs nightly. `capture.loss_poller` writes `SOLID-VERDICT.json` beside each
settled night's loss audit, on the audit's own trigger, with every §3.4 term read from its real input
(`solid_night_inputs.py`: the loss audit's wear end and per-gap list, the negotiated rate, the RUNS sidecars'
own `min_run`, the seam/RTC clock records) and the §3.1 run — "S solid of N nights over D days" — in
`result.run` and STATUS. Timebase is UNKNOWN until the residual pass lands, so every night reads UNKNOWN for now.
