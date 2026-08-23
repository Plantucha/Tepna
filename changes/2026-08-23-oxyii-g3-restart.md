---
bump: minor
type: added
brief: OXYII-ACQUISITION-CHARTER-2026-08-23-BRIEF.md
---

`capture-host/oxy_restart.py` — restart-safe acquisition state (charter G3), standalone and pure. On
start it turns the ledger plus what is on disk into a work plan, consuming `oxy_inventory.reconcile()`
rather than re-deriving state from the filesystem.

The charter's requirement is a negative one — "an interrupted transfer is re-queued or explicitly
restarted, NEVER silently trusted" — so there is no branch that turns doubt into trust. A recording
is left alone only when the ledger says COMMITTED and the bytes still match. The named control is the
kill between download and commit: bytes on disk, right size, validation passed, commit never ran.
`reconcile()` alone calls that "verified", so a planner stopping there would never finish it.

A `.part` is never adopted whatever its size, and a size that drifted under a verified row is
quarantined rather than re-pulled or trusted — re-pulling destroys the evidence, trusting launders it.

14 tests, 100% statement and branch on the module and on the lane. Three mutants re-applied to confirm
the controls bite.
