---
bump: patch
type: fixed
brief: none
---

Record which configured device owns each telemetry stream where the stream is registered and publish it as `streams[].device`, so `capture_status.py` and the monitor page join streams to devices by ownership instead of by key spelling — which matched 2 of 10 streams on the live box by accident and rendered a Verity writing 16.8 MB as idle; an unmatched configured name now renders as UNMATCHED, never as idle.
