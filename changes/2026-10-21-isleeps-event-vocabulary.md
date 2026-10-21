---
bump: patch
type: changed
brief: none
---

Tally every iSleeps `Event name` the AHI derivation cannot place, and separate a measured zero from an unexamined set.

The iSleeps leg dropped an event name outside `ISLEEPS_AHI_EVENTS` plus `RERA` and kept no record. Its pooled report read `measured: false` over all 40 workbooks. A scoring in an unknown name therefore stayed invisible on that half of the corpus. The leg now keeps the `other` Map the ISRUC leg already keeps.

One corpus run answers the question the row left open. Over the 40 workbooks exactly one name sits outside the list: `Body event`, one cell in one record. A body-position event is no apnea, so no derived index moves.

The pooled report gains two flags. `contextMeasured` separates a set that declines context by name from a set with no such class. `unmeasuredRecords` counts the records inside a measured set that carry no tally of their own.
