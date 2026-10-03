---
bump: patch
type: fixed
brief: none
---

A night becomes eligible for its loss verdict when its DEVICE DATA goes quiet, so the poller's own
writes can no longer keep it unjudged. `nightqc.data_settled` is the new predicate and
`newest_data_mtime` is what it reads; `diskguard.active_nights` keeps its own job — "is anything
writing here", the right question for destructive work and the wrong one for a verdict.

**The exclusion that made this work now holds by RULE.** `OXYLIFE.csv` was dropped from
`newest_data_mtime` only because a name with no `_` does not parse as a capture name at all, so the
daemon's own lifecycle chatter was excluded for the wrong reason: stamping that writer the way LINK and
CLOCK are stamped would have made it age the night, move `_current_night` and restart the settle clock.
`OXYLIFE` is now in `_SIDECAR_TAGS` and the fixed name in `_DAEMON_FIXED_NAMES`, with a test that plants
both spellings and asserts the stamped one really parses. No behaviour changes today — that is the point.

**And the reconnect budget is measured instead of trusted.** VIGIL-OVERNIGHT-FINDINGS P2.1 required
< 20 attempts/hour and `_RECONNECT_BACKOFF_CAP_S`'s comment predicted ~17/h; nothing checked either.
E16 reported the doffed-ring rescan as a defect and the measurement closed it as the spec working —
35 cycles over 116 min is 18.1/h on a 199 s cycle — so **no constant moved**, and the gap it exposed
(no instrument for the rate) is filled by `retry_rate_per_hour` / `retry_budget_alert`, which return
null over a partial window rather than extrapolate an alert on every daemon start.
