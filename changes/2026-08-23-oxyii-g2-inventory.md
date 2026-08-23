---
bump: minor
type: added
brief: OXYII-ACQUISITION-CHARTER-2026-08-23-BRIEF.md
---

`capture-host/oxy_inventory.py` — the OxyII acquisition inventory ledger (charter G2), as a
standalone module: append-only JSONL, states DISCOVERED / PARTIAL / VERIFIED / COMMITTED, identity =
device id + session stamp (never a timestamp alone), and a pure `reconcile(ledger_rows,
disk_listing)` for G3's restart recovery.

The central rule is that SIZE EQUALITY IS NOT COMPLETENESS: `parse_oxy_trailer`'s own docstring
records that the ring reports full size before the trailer flushes, so a right-sized file without the
`48 12 5a da` finalisation sub-magic is PARTIAL, never VERIFIED. That case is planted as a control.

No wiring — no capture.py, pull_session.py or writers.py touch; the `_pull_once` ledger-first clause
is G1's. The four plumbing functions are allowlisted in `find_unwired` with reasons and an explicit
note that the LOGIC functions must never join them.

24 tests, 100% statement and branch coverage on the module and on the lane.
