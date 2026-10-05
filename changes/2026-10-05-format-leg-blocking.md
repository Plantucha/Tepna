---
bump: patch
type: changed
brief: none
nodes: [capture-host]
---

`capture-host/check.sh`'s `format` leg is now BLOCKING and checks the WHOLE TREE, on the owner's
2026-10-05 notice ("Add formatter."), which discharges the fleet-notice condition the leg had carried
since it was written. A matching `ruff format --check .` step joins the CI workflow beside `ruff check .`,
so the enforcement is agent-neutral rather than hook-coupled.

Both halves of the change matter, and the second more: advisory → blocking, because the advisory line
printed `format=ISSUES` through 2026-10-04 and was read as noise while four files sat drifted on main; and
changed-files → whole tree, because drift on MAIN is the thing being caught and a changed-files check
structurally cannot see a drifted file the branch does not touch (it printed "nothing in scope" and
passed).

The four drifted files are formatted. No mutation-ledger key moved and no entry orphaned — established
against the actual diff rather than by a gate run.
