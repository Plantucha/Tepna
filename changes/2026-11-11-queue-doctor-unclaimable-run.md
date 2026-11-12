---
bump: minor
type: added
brief: none
---

- `tools/queue-doctor.mjs` now names a queued workflow run that cannot start.
- A run holding no job never expanded, and a run past the 24 hour queue limit was never claimed.
- Each kind holds the queued pool above zero for ever, so the tool reports the pend count without them.
- A pending or absent required context over such a run now reads as its cause.
- The remedy there is a new head, never a wait.
