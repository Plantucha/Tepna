---
bump: minor
type: added
brief: none
---

A radio that stops answering HCI is now REPORTED (residue `2026-09-11-dead-adapter-goes-unnoticed`): the watchdog probes every enumerated radio each poll — the HCI round trip `_adapter_responds`, previously asked only of the pinned radio and fed only to a classifier — and appends one row per radio to `<root>/ADAPTERHCI.csv`; the nightly QC tick writes a third object, `ADAPTERHCI-VERDICT.json` (gate `adapter-hci`, `tepna.verdict/1`), from the rows in the night's session window under a rule pre-stated before the journal was measured (≥ 2 consecutive unanswered polls FAIL · an isolated miss SHORTFALL · all answered PASS · all undeterminable UNKNOWN · no rows NOT_RUN). Report only: the recovery ladder acts on the pinned radio as before and a non-pinned reset stays the owner's action. `STATUS["adapter_hci"]` carries the live roster.
