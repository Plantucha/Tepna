---
bump: patch
type: fixed
brief: none
---

A configured device carrying neither `name` nor `device_id` was keyed `None` in `nightqc`'s declared
map, and `sorted()` then compared that None against the str keys beside it. The exception is caught by
the verdict's own handler, so the night does not crash — it returns **UNKNOWN with the TypeError named
and `result: None`**, discarding every correctly-configured device's coverage and degradation. One
malformed entry makes the whole night unjudgeable.

Fixed at the source: a device with no identity cannot be addressed in `missing` (whose entries are
`f"{name}:{stream}"`), so it is EXCLUDED and NAMED by the streams it declared — the population equality
`checked + excluded == eligible` carries it rather than dropping it. It is reachable: #3040 hardened the
qc ALERT path against exactly this input; this path was not.

Also restores mypy to the baseline: 8 errors appeared after #3065 and #3067 and none disappeared. Seven
descended from this one defect; one (`nightqc.py`'s basis lookup, #3067) was a genuine annotation gap
where the None is deliberate. **Baseline untouched at 37, and the error SET is identical to it — 0
appeared, 0 disappeared, verified by set diff rather than by count.**

⚠️ The rise is the §∅ absence programme reaching the value layer before its consumers: both PRs made
absence explicit, mypy saw the Nones arrive, and mypy is ADVISORY — so a verdict-path defect sat on main
for a day behind a count that only went up.
