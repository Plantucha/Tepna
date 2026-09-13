---
bump: patch
type: fixed
brief: none
---

The absent-device-stamp refusal logged one journal line per frame, on the stated basis that it was rare —
and the number behind "rare" was transposed from a different measurement.

`capture.py`'s guard (#2405, 2026-09-12) carried the comment *"Rare by measurement — 22 in 14 days — so
one line each is affordable and a rate limit would only hide a change in rate, which is the interesting
signal."* The reasoning is right; the arithmetic under it is not. The source of "22" is
`nightqc.py:1148`, which measured **22 of 23 refused *streams* over 5 *nights*** in an offline
sidecar analysis. Three independent errors in one transposition: the **unit** (a refused stream spans
thousands of frames, not one line), the **window** (5 nights → 14 days), and the **population**
(nightqc's offline arrival analysis → the live PMD callback).

Measured once the guard actually shipped — it and its comment landed in the same commit, so it had never
run for 14 days — vigil's journal carries **7283 refusals in the guard's first day live**: 2694 on
2026-09-12 from 18:21:45, 4589 on 2026-09-13, and **100 % of them the Verity**.

At 4589 lines/day a rate *change* is harder to see, not easier, because the signal is buried in its own
volume — so the original objection now argues for the rollup rather than against it. `absent_stamp_should_log`
(pure) emits the **first** occurrence always, because onset is the whole point of the guard, then one line
every `ABSENT_STAMP_LOG_EVERY`, each carrying its running count so the rate stays recoverable from the
journal. A day of the measured storm becomes under twenty lines and never one, since collapsing to a
single line would lose the rate.

Filed separately as residue `2026-09-13-verity-emits-absent-stamps-at-scale`: the guard exposed a device
behaviour nobody has explained. Two independent instruments agree the Verity's PPI timing is absent rather
than noisy — the live guard (7283/day, all Verity) and `nightqc`'s offline count (`last_sensor_ns` literally
0 for all 4864 packets of every Verity `ppi` stream). What the zero *means*, and whether any consumer spends
those intervals with a fabricated time, is not established and is not guessed at here.

One of the three new tests is marked as **not discriminating** — it passes under the old per-frame
behaviour too, by construction, and exists to stop a future cadence change swallowing the first line. The
other two red on a revert, verified by planting the per-frame behaviour back.
