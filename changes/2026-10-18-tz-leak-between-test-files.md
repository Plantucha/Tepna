---
bump: patch
type: fixed
brief: none
---

Restore the process timezone after every capture-host test. A teardown that drops `TZ` left the C library on the box's own zone. A suite launched `TZ=UTC` then ran every later file in that zone.
