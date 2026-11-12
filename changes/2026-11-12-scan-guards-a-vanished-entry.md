---
bump: patch
type: fixed
brief: none
---

The polarity scanner no longer dies when a file leaves between its directory read and its stat. The scan skips that one entry and names it in a new `vanished` field. A directory nobody can open still refuses. The corpus census also writes its selftest scratch file to the system temp directory under a per-pid name, so no peer selftest walks onto it.
