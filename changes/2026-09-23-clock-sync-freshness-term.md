---
bump: patch
type: fixed
brief: none
---

`clock_sync_due` had **no freshness term**. It fired on every reconnect regardless of when the device's
clock had last been successfully written, and every firing that reaches the device pauses live capture.

Measured across every night carrying a `CLOCKSYNC.csv` (23 nights): **903 consecutive successful-sync
pairs for the same device, of which 276 (31 %) are within 120 SECONDS of the previous success**, 345
(38 %) within 300 s and 700 (78 %) within 30 min. On 2026-09-19 the Verity synced at 18:06:43 and again
at 18:07:25 — 42 s apart, each taking the device. At the H10's measured −20 ppm, 120 s of drift is
**2.4 microseconds**.

**The sibling caller already learned this.** `clock_watchdog`'s docstring: *"Triggering on `skew != 0`
would re-sync it forever, pausing capture every cycle for nothing. So we trigger on a CHANGE in skew."*
That lesson never reached the reconnect-driven path — the one that runs hundreds of times a night.

`synced_age_s` is added LAST and defaults to `None`, so positional callers are unaffected, and the four
existing arms are untouched. **`None` must not block**, and that is §∅ rather than a convenience: a
device that has never synced has no freshness, and reading absence as "recently synced" would silently
disable the sync for exactly the device that needs it most. It is measured **monotonically** — freshness
is elapsed time, and §🔒 is explicit that `_now()` re-anchors on an NTP step, which this daemon takes.

**The window is derived, not chosen.** The daemon already states its skew tolerance: `clock_watchdog`
re-syncs on a `resync_jump_sec` change (live config 30.0 s) and deliberately leaves a constant offset
alone. 30 s of skew at −20 ppm takes **17 days** to accumulate, so 1800 s sits orders of magnitude inside
the tolerance already in force — and the watchdog remains the backstop, polling every `drift_check_sec`
(live config 300.0 s). That backstop demonstrably operates: the straps DO step their clocks, **338
`resynced` rows over 23 nights**, and those are caught by the watchdog rather than by the reconnect path.

The 2026-07-18 guarantee this predicate exists for is untouched: a docked Polar's write FAILS, records no
freshness, and every reconnect retries. `test_run_polar_rewrites_the_clock_on_the_SECOND_connection` was
asserting that guarantee with a fake that SUCCEEDED, which made it test re-sync-after-success instead —
a different claim. Its fake now fails the first write, which is the scenario its own docstring describes,
and a new sibling pins the new behaviour.

⚠️ **The one way this could still lose signal**, stated as a test: a strap synced 25 min before bed and
then donned is inside the window, so its reconnect is skipped. That is safe rather than tolerated —
25 min at −20 ppm is **30 ms** against a stream whose sample period is 7.7 ms, and a clock that actually
STEPPED is corrected by the watchdog inside the window instead of waiting it out. A window long enough to
span a night would not be safe, which is why the test asserts the far edge too.

Together with `2026-09-23-clock-sync-pauses-live-capture.md` this attacks pause DENSITY from both ends —
the backoff bounds repeated failures, freshness bounds redundant successes — and density, not duration, is
what blinds a 60 s watchdog: the longest single pause measured was 68 s against a 60 s tick, while up to
**10 consecutive ticks** were skipped.
