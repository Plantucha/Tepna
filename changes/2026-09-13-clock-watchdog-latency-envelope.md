---
bump: patch
type: fixed
brief: VIGIL-BLE-ROBUSTNESS-2026-07-19-BRIEF.md
---

`clock_watchdog` re-synced Polar device clocks on **delivery latency**, not on drift.

`clock_skew_sec` is `device_stamp − _utcnow()` taken when a PMD frame *lands*, so it is the clock offset
minus the packet's fill time, BLE buffering and any link stall. Latency is one-sided, so a single reading
can only understate the offset and a stalled link is indistinguishable from a drifting clock.

Measured on vigil over the 14 days to 2026-09-13 (journal, 503 295 lines): **341 adrift re-syncs** — 302
H10, 39 Verity — up to **74 in one day**, a median **330 s** apart against a 300 s `drift_check_sec`, i.e.
on every watchdog cycle. **Every one was negative**, the sign latency produces, with an H10 median of
**−3.6 s** against a true link delay of ~0.23 s measured off the PMDARRIVAL sidecars.

**The arithmetic that rules out drift:** this H10's crystal measures −20.3 ppm, so 330 s of real drift is
6.7 ms. Returning to −2.0 s within one cycle of a successful clock write would take ≈−6700 ppm — three
hundred times a crystal's rate. A clock cannot do that; a stalled link does (5689 connect timeouts in the
same window). Each trigger pauses live capture and holds the connect lock.

The watchdog now decides on `clock_skew_floor_sec`: the **maximum** skew over `CLOCK_SKEW_WINDOW_S`,
computed by the pure `clock_skew_estimate`. Because `skew = offset − latency` with `latency ≥ 0`, the
maximum is the least-contaminated sample in the window, and it recovers the offset for either sign — the
same lower-envelope reasoning `clock_offset.estimate` already uses on the arrival sidecars, in the
opposite sign convention. It **refuses** below `CLOCK_SKEW_MIN_N` rather than returning a single
contaminated read wearing the shape of a statistic, and the watchdog then does nothing (§∅).

Second, independent: **the give-up could never be reached.** `failed_adrift` counts corrections that did
not move the skew and is the only thing that stops an unfixable device being re-synced all night, but any
successful *write* recorded in `_CLOCK_FRESHLY_SYNCED` zeroed it — and the H10 reconnects constantly (445
`connected` events in 14 days), so the reconnect ladder discharged the budget before it could count to 3.
The give-up fired **0 times** in 14 days across 341 re-syncs. A successful write is not a successful
correction; the drain now hands the verdict to the next cycle's measurement (`tried_adrift`), which
preserves the documented docked-device recovery while making it measurement-driven.

`clock_skew_sec` is unchanged and still published — demoting a displayed value to fix a decision would be
a second bug. `clock_skew_floor_sec` and `clock_skew_n` ship beside it to the monitor, so a re-sync that
disagrees with the live reading is explicable rather than mysterious.

`VIGIL-BLE-ROBUSTNESS` §6 is flipped from **LATENT** to **live and measured**, with the note that the
2026-07-20 retraction was right to refuse an unmeasured claim and that its explanation of why the trigger
does not repeat does not describe what the box does.

Gate: `capture-host/check.sh` green. The three behavioural guards were plant-verified — reverting the
watchdog to the per-frame key and the budget to the eager reset reds all three.
