---
bump: patch
type: fixed
brief: PYTHON-TYPES-AND-FORMAT-2026-08-27-BRIEF.md
---
mypy session-lane batch 1: the BleakClient `**kw` splat. Six call sites built a dict and splatted it
into BleakClient, which mypy fans out across every overload candidate — 35 error lines from 6 sites,
37% of the arg-type/assignment population, all one root cause. Replaced the splat with an explicit
`bluez=` keyword, which is a real parameter. capture-host mypy 189 -> 154; baseline updated.
capture.py uses conditional CONSTRUCTION rather than an unconditional `bluez={}`, because
test_cpap_ble_connect_without_an_adapter_passes_no_bluez_kwarg pins that no bluez kwarg reaches
bleak when there is no hci — the test caught the difference and it is a real contract, not a nicety.
