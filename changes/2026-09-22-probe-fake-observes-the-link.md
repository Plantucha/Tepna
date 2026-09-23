---
bump: patch
type: changed
brief: none
---

`capture-host/tests/test_probe_oxyii_0x03.py`: the 0x03 probe's fake ring now records everything the probe hands the link — the scan filter and its timeout, the device the client is opened on, every frame written (so the running seq byte is checkable), the characteristic notifications are stopped on, and a SENTINEL default for `response` so a dropped `response=False` is visible — and seven tests assert them. `run()`'s surviving mutants drained 63 → 4 (three SystemExit-prose strings the diff gate excludes by rule, one proven equivalence filed in `mutate-equivalence.json`). The 153 survivors in the module's other functions are re-measured and bucketed in residue `2026-09-22-probe-survivors-outside-run-measured`.
