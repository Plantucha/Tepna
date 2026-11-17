---
bump: patch
type: fixed
brief: none
---

GlucoDex no longer files an unstated diabetes status or therapy as `'none'`. The profile substituted that word for a user who never answered. It then chose the expected GMI and the TBR goal from it, and it published the goal as the user's own target.

An unstated status now gives no expected GMI, and an unstated therapy gives `tbrGoalPct: null`. The badges still grade time below range against the stricter 1 % bound, and the new export field `tbrGoalInForcePct` names the bound they used. The KPI card says `therapy not set` beside it. The QTc row and the export `qtcThresholds.sexStated` say when the sex-specific bound rests on an unstated sex. Shrike found the sites in task 32, and Kestrel verified and reviewed them.
