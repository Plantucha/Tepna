---
bump: patch
type: fixed
brief: none
---

Read the ring's own push record before calling an RTC jump a battery-event reset. A correction
the capture-host wrote itself no longer reads as the device losing its clock.
