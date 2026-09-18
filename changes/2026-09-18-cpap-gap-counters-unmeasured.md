---
bump: patch
type: fixed
brief: CPAP-ACQ-P3-GAP-ACCOUNTING-2026-09-18-BRIEF.md
---

Two published CPAP aggregates were built from counters that nothing can increment, so they reported
**absence as zero**.

Verified independently before changing anything (2026-09-18, `origin/main` `43bd8e00`):
`BoundedIngestQueue` is constructed in **tests only** — five sites, all `tests/test_cpap_ingest.py` — so
`overflow`'s single writer at `cpap_ingest.py:138` is unreachable in production; and `post_drop_tail` and
`stalls` have **no incrementer anywhere**.

* **`total_lost`** was `overflow + malformed + post_drop_tail`, documented as *"the honest 'how much did
  we miss' number"*. Two of three terms could not move, so it was identically `malformed` — decode loss
  only, while reading as though it covered transport loss. It now sums only terms that can move, and the
  new **`lost_coverage`** names the categories it does not cover.
* **`transport_gaps`** on the acquisition-evidence surface was `overflow + post_drop_tail` — both dead —
  and published as a forensic category *"so a reader can tell WHY it is incomplete"*. A reader saw `0`
  and concluded no transport loss occurred.

⚠️ **`_counter` already stated the right principle and its own code defeated it.** Its docstring says
*"absent accounting is UNKNOWN, never a fabricated 0 — 0 means 'counted, and none happened'"*, while the
body read `int(summary.get(k) or 0)`, which turns an unmeasured term into a measured zero. One unmeasured
term now makes the sum UNKNOWN: a partial total published as a total is the same lie in smaller print.
The absence propagates exactly as far as it reaches — `decode_gaps` is unaffected and still reports.

Per §∅, `stalls` and `post_drop_tail` are now **`None`, not `0`** — the fields stay, and the *value*
carries the absence, because a missing field is visible and a zero is not. `stalls` in particular carried
a spec citation (§30 STREAM_STALL) with no detector behind it.

⚠️ **The queue wiring is NOT in this PR, and the reason is a scoping fact worth recording rather than a
deferral.** `stream_to_bus` is a single sequential `async for`: producer and consumer are the same
coroutine, so a bounded queue between them would never hold more than one item and `overflow` could never
fire. Wiring it as-is would be decorative — the half-wired shape this brief exists to remove. A real
overflow requires decoupling the transport callback from the sink, which is a producer/consumer change on
the P0 capture path and its own risk profile. Named here so the next picker-up does not discover it after
starting.

Gate: `capture-host/check.sh` all green — 7298 passed, coverage 100.00 %, `unwired` clean.
