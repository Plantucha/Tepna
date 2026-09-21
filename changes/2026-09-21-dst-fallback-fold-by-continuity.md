---
bump: patch
type: fixed
brief: none
---

Resolve the DST fall-back hour when reading the box's naive local `Phone timestamp` — by host−device continuity where a device stamp rides along, by monotonicity otherwise — so the host axis no longer steps backwards by an hour inside a series on the one night a year the wall clock repeats; the next such night for the box is 2026-11-01 and this code had never been through one.
