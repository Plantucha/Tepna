---
bump: patch
type: fixed
brief: none
---

Bring the BLE scan under `_CONNECT_LOCK`, the same lock the connect already takes. The scan ran
outside it while the connect ran inside — two operations needing the same adapter, one serialised and
one not, which is what let a scan overlap the clock-sync path's adapter ops. Bounded as before: the
lock is held only for the scan's own timeout.
