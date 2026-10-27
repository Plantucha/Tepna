---
bump: patch
type: fixed
brief: none
---

Give the re-anchor census a verdict the contract accepts. A run told not to probe is
now `NOT_RUN` carrying no result. A ledger with nothing drifted is `NOT_APPLICABLE`.
Probes that all reached no verdict are `UNKNOWN`.
