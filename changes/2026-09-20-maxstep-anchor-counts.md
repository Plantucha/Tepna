---
bump: patch
type: fixed
brief: none
---

`tools/pat-host-offset.mjs` juxtaposes `maxStepE` and `maxStepP` in one row at a ~30% temporal density
difference. Measured on 8 real H10 nights: no systematic bias (median ratio 1.015) but up to -46%/+25%
per night, because a max is an extreme-value statistic. Each value now travels with its anchor count.
