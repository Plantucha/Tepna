---
bump: patch
type: fixed
brief: none
---

Read PEP 440's pre-release and dev segments in the dev-floor check, so an installed `9.2.0rc1`
reads as a shortfall rather than as a version the gate cannot order.
