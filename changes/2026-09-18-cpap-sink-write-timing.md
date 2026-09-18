---
bump: minor
type: added
brief: CPAP-ACQ-P3-GAP-ACCOUNTING-2026-09-18-BRIEF.md
---

Times the CPAP sink write, so a loop stall becomes **attributable**.

`stream_to_bus` is a single sequential `async for` — producer and consumer are the same coroutine — so a
slow sink stops the loop pulling frames. Measured 2026-09-18 (#2638): the loop stalls 10–35×/day, median
**1502 ms**, and **121 of 151** logged stalls fall inside a CPAP stream (1.35/h against 0.14/h outside).
That says the streaming path is involved; it does **not** say a sink is the holder, because the loop-lag
detector measures the **shared** event loop and cannot name what held it.

**Why a timer and not asyncio debug mode.** Measured both rather than reasoned: debug mode names the
**Task** (it did discriminate `cpap-stream` from `wearables`) but structurally cannot name the function,
because a long synchronous block runs *between* awaits. It also costs **12.1×** on loop churn, ≈10 µs per
step. A `monotonic()` pair costs **97 ns**, which at the 5.2 frames/s a real session delivers is **1.8 ms
per hour of streaming**. No debug-mode flag was added: a disarmed-but-present mechanism reads as armed,
which is the configured-but-inoperable rung `capture.py` already warns about.

⚠️ **An untimed sink reports `None`, never `0`.** `sink_max_ms: 0.0` would say *"timed, and it was fast"* —
a measurement nobody made. A stream with no `extra_sinks` times nothing and reports None; a stream that
timed a fast write reports a real `sink_slow: 0`, meaning *counted, and none were slow*. Both states are
tests, because this is the `int(summary.get(k) or 0)` defect the same module was fixed for two PRs ago and
it would be trivially reintroduced by defaulting to 0.

**A maximum alone answers the wrong question**, so `sink_slow` counts writes at or over `SINK_SLOW_MS`.
The threshold is **anchored to `capture.py`'s `_LOOP_LAG_WARN_MS`, not chosen**: that is the size at which
a held loop is logged as a stall, so a sink write crossing it is one that could have produced one of the
151 measured stalls. A max tells you the worst write on the worst night; max plus count distinguishes a
mechanism from an outlier.

**A sink that RAISES is still timed** — the timing sits in a `finally`, so a write that fails is counted up
to the failure. Otherwise the slowest writes, the ones that time out and then raise, would be exactly the
ones never measured.

Additive only: no signature changed anywhere, because the timing uses the `counters` object already in
scope. Every existing caller and pump fake is byte-identical.

⚠️ **This produces no data until the box pulls it**, on the ordinary `tepna-update.timer` cycle, and then
needs one streaming night. The gate does not resolve on merge. W2(b) moves from *gated on an open
question* to *gated on one night's data* — an item waiting on a clock rather than on a decision.

Gate: `capture-host/check.sh` all green — 7350 passed, coverage 100.00 %.
