---
bump: patch
type: added
brief: none
---

**The untimed-group ratchet, and three CI comments that had drifted ~2x.**

`tests/verify-shard-timings.mjs` (new, static job, ~5 s) emits one `tepna.verdict/1` over the
EXECUTED group set and refuses when the SHARE of groups with no committed timing exceeds a
pre-stated, shrink-only cap of 5 % — measured 2026-10-10 at 29 of 727 = 3.99 %.

A share and not a count: the first version capped the count at the measured 27 and went red on the
very next merge, which added two groups. A new group is unpriced by construction, so a count cap is
a toll on adding tests rather than a finding. The share refuses drift and tolerates growth.

It gates the COUNT, never the timings' freshness: `group-timings.json` stays a HINT by its own
header's decision (drift degrades balance, never correctness), and that decision is untouched. What
the ratchet refuses is the untimed set growing SILENTLY — before this, the only report was one prose
line printed mid-run, where nothing reads it.

The group set is runtime-generated (686 `group('` call sites produce 725 executed groups), so a
source parse would ratchet against a denominator 39 short; `--list` enumerates the real set without
executing it in ~4 s, which is what makes this a gate instead of a nightly report.

Also corrected, each with its date and its measurement: `fitClockClosure` 208.9 s → **4.3 s**, suite
total 481.2 s → **331.7 s**, the python legs ~12m30 → **6.5 / 5.0 min** (run 38087359921). The
"plan is GROUP-BOUND, total/6 unreachable at any N" paragraph was not renumbered but REWRITTEN: the
planner now reports `makespan 55.3 s of 331.7 s → 6.00x` at `max / mean = 1.000`, the ideal split.

`verify-shard-union` and the sharded-vs-unsharded equivalence are untouched.
