---
bump: patch
type: changed
brief: none
---

Ledger-only: records that the BLE counters cannot tell an absent device from a failing one, and that
windowing cannot fix it.

New residue row `2026-09-19-ble-rate-cannot-see-absence`, found while triaging its sibling
`2026-09-16-ble-counters-not-drawn` and logged before anyone builds to that row as written.

## The finding

The sibling row names the windowing decision as *"the actual work — not the drawing"*. That is true and
it is not sufficient. A docked Polar or ring does not answer a connect, so its attempts time out and its
`rate` reads `0.0` — a correct count and a useless alert input, because **"all fine, nothing worn" and
"radio failing" have the identical shape.**

**Windowing is orthogonal**, which is why this is a row and not a caveat: a windowed `0.0` on a docked
device is still `0.0`. Narrowing the period changes the number's freshness, not its ambiguity. A consumer
built to the sibling row as written — window, draw, alert on a rising retry rate — would ship an alert
that fires on every night the sensors stay on the dock. That is the failure mode where an alert gets
muted and then keeps being trusted while muted.

Measured live: two of three devices at `0.0` (9 attempts / 0 successes, and 7 / 0, all timeouts), against
a window in which nothing was worn.

## What the row is careful not to say

- **`blestats.py` is not the defect and must not be "fixed".** It is a counter, it counts correctly, and
  its §∅ rule — a rate over zero attempts is `None`, never `0.0` or `1.0` — is right. What is missing is
  a **presence predicate at the consumer**.
- **It does not claim the two readings are wholly benign.** Nothing worn explains the timeouts; it does
  not prove no radio fault is also present.
- A presence signal already exists (`STATUS["devices"]` `connected`/`charging`, and worn state via
  `hr_contact_bit`). *Which* of those is the right denominator gate is the open question — a decision
  owed **before** the draw.

## Why no code

Adding a window to a counter module with no consumer would be adding unconsumed mechanism to fix
unconsumed mechanism — the defect class the sibling row is about, enlarged while appearing to close it.
The consumer's requirements decide the window (period, reset-on-restart, per-device or per-adapter), so
consumer-first is the only order in which those choices are non-speculative.

Recorded for whoever picks up the draw, together with the precedent worth copying: the **RADIO DISTRESS**
sidebar consumer in `monitor.html` solved this exact shape once already — *"computed nightly and published
to status.json where NOTHING read it … This is that consumer."*
