---
bump: minor
type: added
brief: none
---

Add `verify:hook-contract`. The gate reads every Claude Code hook three ways.
A static scan finds an exit before the stdin drain.
A probe stages a payload above `fs.pipe-max-size` and reads the writer's SIGPIPE.
An enumeration check fails any hook the probe table omits.
The gate emits one `tepna.verdict/1` object.
