---
bump: patch
type: fixed
brief: none
---

Report a null `maxAbsBias` with the reason `no-key-scored` when the TCH reference record scored no night, instead of 0. The privacy scrub of such a record reads `NOT_RUN`, never `PASS`, so `tools/tch-reference-record.mjs` refuses to write it. A private-data finding still reads `FAIL`.
