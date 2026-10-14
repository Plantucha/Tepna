---
bump: patch
type: fixed
nodes: [OxyDex, suite, capture-host]
brief: RESIDUE.md
---

Six RESIDUE rows close. Each patch came from the API coder lane. A local re-run proved each one: the new
test fails on `main` and passes with the patch.

- OxyDex `parseTimeStr` answers `null` for an unreadable stamp, so the periodicity gate never places a spike at midnight.
- The nadir ramp window measures elapsed seconds on `tMs`, not array positions.
- The loss audit names a night with no file instead of attributing it.
- The mutation workflow step declares its own cap below the job cap and reports a timeout by name.
- The trio fold tools share one merge rule in `trio-anchor.mjs`.
- Both lane inventories list five more root sources, so a source gate can read them.
