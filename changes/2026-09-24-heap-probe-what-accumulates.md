---
bump: patch
type: added
brief: none
---

`loop_monitor` measures the one resource every stream shares and its own docstring says what it cannot
do: *"that lateness IS the time some other callback held the loop"* — without naming the holder. This
adds an on-demand instrument that names one candidate, and **only instruments it**: nothing here calls
`gc.freeze()` or moves a threshold, because a remedy chosen before a night correlates gen-2 durations
with the stall instants would be a guess dressed as a fix.

**The observation** (2026-09-23, the first night under #2936; re-read 2026-09-24). `loop.lag_max_ms`
rose 272 → 292 → 337 → 401 → 457 → 523 → 593 ms between 00:07 and 04:15 with 40 stalls ≥ 100 ms, and
`RssAnon` rose 128 → 245 MB on the same slope, linear at ~21 MB/h. Both went flat at **04:22–04:24** —
and the discriminator is what did *not* stop there: the **H10 kept streaming ECG+ACC until 04:49:58 and
the heap did not move for those 25 minutes**, while the Verity stopped at 04:21:52 and the ring at
04:25:35. So the accumulator is in the Verity or ring path, not the H10's, and 21 MB/h is an order of
magnitude consistent with per-sample retention (a 4-channel Verity PPG hour is ~790k values).

**What it does.** `heap_probe.enabled` (OFF by default; arming is the owner's restart) waits for capture,
then after `start_after_min` starts `tracemalloc.start(1)`, arms a `gc.callbacks` pass timer, and takes
`snapshots` snapshots `interval_min` apart, writing `captures/heap-probe.json` (`tepna.heap-probe/1`)
**after each snapshot** so a restart mid-window leaves the rows it reached. Each row carries the traced
bytes, `len(gc.get_objects())`, per-generation pass counts and durations, and the top-N
`compare_to(prev, "lineno")` growth rows — one frame, so the allocation site *is* the container.

**Why not the two obvious instruments.** A `gc.get_objects()` type histogram names a type and never an
owner, and walking every object is itself a gen-2-sized pause — it would produce the symptom it measures.
Always-on tracemalloc taxes every allocation on the very loop whose latency is under investigation.

**The countdown starts at CAPTURE, not at boot**, and that is the difference between a measurement and a
verdict about a period nobody pointed at: the daemon routinely starts hours before bed (09-23 booted
23:00:54 against capture at 23:13; the night before restarted 18:16, 18:53, 20:56 against capture at
22:38), so a boot-relative window would sit over an idle heap and write "no growth found".

⚠️ **An interval that covered no capture is `NOT_APPLICABLE`, never an empty growth list.** The two look
identical in the output and are opposite findings, so the interval sleep is chunked and each row carries
`covered_capture` and `live_streams`.

⚠️ **The gen-2 durations are taken with tracemalloc active and are therefore inflated** — they indicate,
they do not measure, and that caveat rides on every row rather than in a docstring. `gc_tracked_objects`
is unaffected, and since a GC pause scales with the tracked-object COUNT, the count is the term the
hypothesis turns on: if it does not climb with the bytes, the lag has another cause and the hypothesis
dies the same night while the instrument stays.

§∅ throughout: `gen2_last_ms` / `gen2_max_ms` are **None until a gen-2 pass completes** (a window may
legitimately contain none, and a 0.0 would falsify the hypothesis with a number nothing measured); a
`stop` phase with no recorded `start` is dropped rather than timed from an invented origin; the first
snapshot's growth list is empty rather than a fabricated zero-growth row.

All three generations are timed, not just gen-2: the callback fires on every collection once registered,
so skipping gen-0 saves an arithmetic operation and no call — and **gen-0 is the control**, scanning a set
bounded by the collection threshold, so it cannot grow with the heap. Measured cost **+0.7 µs per gen-0
pass**, of which 0.3 µs is CPython's own callback dispatch; the timer is window-scoped and disarmed in a
`finally`.

The growth plant is not vacuous: with the allocation removed the diff is **not** empty — it carries the
probe's own allocation rows — and the test still fails on "must NAME the grower by file:line", so it
discriminates a diff that names the grower from one that merely has rows.
