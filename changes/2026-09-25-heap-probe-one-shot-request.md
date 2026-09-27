---
bump: patch
type: fixed
brief: none
---

The heap probe now traces only when **explicitly requested**, and the request is **consumed on arm** so a
restart does not repeat it. `heap_probe.enabled` remains the permission; a marker file
(`<root>/heap-probe.request`, or `heap_probe.request_path`) is the request.

🔴 **Because the probe degraded the night it was diagnosing.** `enabled` is a STANDING permission, so the
probe armed on **every daemon start** — four on SOLID-NIGHT night 1. While tracemalloc traced
22:19:56 → 00:21:01 the box logged **25 event-loop stalls of 1–12 s at the QC poll's 10-minute cadence**,
and **58 of the 64 H10 host inter-arrival gaps over 1 s fall inside that window**; in the two hours after
tracing stopped, 3 stalls. The owner read it on the monitor as "fragmentation". The recording itself was
whole — `gaps_in_night: []`, one session, 13.7 M rows: the host stamps waited, the device clocks did not.
**A diagnostic that degrades the night it diagnoses is not a diagnostic**, and a standing flag meant it
would have done the same again the next night without anyone asking.

⚠️ **It FAILS CLOSED.** If the request exists and cannot be consumed, the probe does **not** arm — an
un-consumable request would otherwise arm on every start, which is the exact defect being fixed. Refusing
to trace is recoverable; a night degraded by the instrument is not. The file is *renamed* to `.consumed`
rather than deleted, so an operator can see the request was honoured.

**One gate covers all three costs.** `DecodeCensus` (a json wrapper counting decodes per call site) and
`top_container_holders` (a bounded referrer walk) are reached only past the request, so the per-subsystem
attribution added here cannot run on an unrequested night either — asserted by comparing the CALL sites'
positions against the gate, not the definitions'.

**Two measured limits are documented rather than glossed.** tracemalloc returns statistics and never the
objects, and plain `dict`/`list` cannot be weak-referenced, so a referrer walk *from* the decoded objects
is not implementable — hence a per-site decode census, which is what discriminates a 50/s live path from a
~20/h poll. And on CPython 3.13 an object held only in a frame's fast local has **zero**
`gc.get_referrers`, so a `null` holder means "not held by a tracked container within the bound", which
**includes** "in flight" — pinned by a test that re-checks the interpreter behaviour it rests on.

Residue `2026-09-25-qc-poll-still-stalls-the-loop-without-tracing` records what remains once the probe is
subtracted: 1–2.5 s stalls at 01:52 and 02:13 with no tracing at all, so #2936 reduced the QC-poll stall
rather than removing it.
