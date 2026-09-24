---
bump: patch
type: fixed
brief: none
---

The automatic device clock sync takes the device through `polar_offline_op`, which **pauses live
capture** — that is how it acquires the strap's single BLE link. The ladder then retried a transient BLE
failure up to 12 times, and every retry bought another pause at the same price.

Measured on vigil for the night of 2026-09-18 (18:00→12:00, journal): **146 attempts took the device,
113 of them abandoned at the op ceiling (77 %)**. Counting the `retry N/12` lines by index splits that
146 into **80 first attempts and 66 retries** — the 66 are pure lost signal. A pause also disables
`adapter_watchdog` and `clock_watchdog`, both of which skip while `_POLAR_PAUSED` is set, so the
mechanism that corrects a drifting clock is stood down by the mechanism that syncs it.

Three changes, in the order of what they bound:

- **A transient failure that already paid a pause declines instead of retrying** (`deferred-after-pause`).
  The pause is observed, not predicted: `blestats.attempt("offline_op", …)` is already incremented
  immediately after `_POLAR_PAUSED.add(address)`, so a move in that existing denominator means exactly
  "this attempt took the device". Nothing is lost — `clock_sync_due` re-arms on the next reconnect, which
  is the same reasoning the absent-device branch has always used.
- **A cross-ladder backoff** (`clock_sync_backoff_s`, doubling from 120 s, capped at 60 min, cleared on
  success). The per-ladder budget bounds one ladder; `clock_sync_due` re-arms it on every reconnect
  (~70–110 s), which is how 80 separate ladders each paid a pause while that budget worked correctly
  throughout. Only a failure that PAID a pause cools a device down: 395 of the night's 553 attempts were
  `deferred-absent` — a 6 s scan, no lock, no pause — and cooling on those would delay the sync for a
  device that is about to come back, which is the reconnect that re-arms the ladder.
- **The 120 s ladder budget is now honoured.** `spent >= budget` can only be answered once the money is
  gone; the box logged `gave up after 153s of a 120s budget` twelve times that night. It now asks whether
  the next attempt FITS, using the longest attempt this ladder has actually run as the estimator rather
  than a constant that would have to enumerate an attempt's parts and would rot when any of them moved.

`CONNECT-LOCK-DUTY-CYCLE-2026-08-09-BRIEF.md` tabulates five previous bounds on this mechanism. Every one
is denominated in lock-seconds or in attempts; none in **paused capture**, which is what the operator
loses. That brief's own lesson — *"a bound on time spent is not a bound on exclusion, and the number that
kept not moving was the one nobody was measuring"* — one axis further out.

⚠️ The suite could not see this: every existing ladder test stubs `sync_device_time`, so none of them ever
took the device. The new plants drive the real `polar_offline_op`, and on `origin/main` the primary one
reports `assert (12 - 0) == 1` — twelve live-capture pauses for one flaky device. A second test in the
same file asserted the budget OVERRUN as the specification ("the 3rd attempt's check sees 135 s and
stops"); it now asserts the spend, not the attempt count.

⚠️ `clock_watchdog` is a SECOND, independent caller of `polar_offline_op` — it calls `sync_device_time`
directly, with no ladder — and is **untouched here**. `2026-09-23-loss-audit-resync-and-address.md`
attributes 147 min of H10 loss over 28 box nights to that path. Two pause sources, one fixed.
