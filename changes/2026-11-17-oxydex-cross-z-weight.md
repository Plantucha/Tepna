---
bump: patch
type: fixed
brief: none
---

The OxyDex cross-night engine publishes an unmeasurable z-score as `null`, not as 0σ. It weighs a night that carries a coverage block by recorded time over span, not by `NaN`.
