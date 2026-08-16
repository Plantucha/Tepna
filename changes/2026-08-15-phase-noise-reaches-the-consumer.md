---
bump: minor
type: added
---

**MDEV could split white from flicker phase noise since #1255. Nothing that runs ever asked it.**

`identify()` and `tdev()` shipped correct, tested, documented and changelogged — with **zero production
call sites**. Verified repo-wide: outside their own definitions and tests, the only mention of
`identify(` anywhere is the changeset announcing it. `nightqc.py` is the sole consumer of `allan`, and
it calls `stability()`, which used **ADEV alone**.

So every real night recorded `white/flicker-phase` — the joint arm — while the module sat one call away
from resolving it. Measured across the whole box corpus in
`briefs/METROLOGY-METHOD-ADOPTION-2026-08-14-BRIEF.md` §3.5: ADEV returned the joint label for **26 of
27** streams — one label for the entire corpus — where MDEV resolved **19 to white-phase and refused 8**.

⚠️ That corpus result was obtained by running `identify()` **by hand**. It described the estimator, not
the system: production was still emitting the joint label for everything, because nothing called it.
Reachability was never checked before the improvement was quoted — which is the same defect as the code,
one level up. (Its own limits carry over: only 27 of 398 files clear 2000 packets, and the H10
contributes 8 streams.)

The two halves of that label give **opposite** advice: white PM averages away as `tau^-3/2`, flicker PM
only as `tau^-1`. A reader told "jitter — averages away fast" about a flicker-PM stream over-estimates
what a longer window buys. That is the whole operational content of the measurement, and it was the half
not being published.

`stability()` now computes the ADEV curve **once** and hands it to `identify()` (new optional last
argument), so the resolution costs one MDEV pass rather than a second ADEV. Three additive fields —
`phase_noise`, `mdev_classification`, `tdev` — leave every existing key untouched.

## TDEV is quoted at a FIXED tau, and there is deliberately no default

Reading each stream at its **own** optimal tau **inverts the ordering**. Measured on the real corpus:
per-stream it reads H10 3.4 ms vs Verity 0.85 ms; at a common tau that flips to H10 ~2.0 vs Verity ppg
~3.5. Returning `{tau, tdev}` records is necessary but **not sufficient** — a caller holding two of them
can still compare across different taus and get the inversion.

So `stability(phase, tau0, tdev_tau)` takes the tau as an argument and **omitting it publishes no TDEV
at all** rather than picking one per stream. A missing number is recoverable; two numbers that look
comparable and are not is the failure this exists to prevent. `nightqc` names `_TDEV_TAU_S = 300.0`.

⚠️ TDEV here is an **upper bound** on the clock's own contribution — the series is `arrival - device`, so
it carries BLE transport as well as the oscillator. Two streams from one recording are **not** independent
corroboration; they shared that night's link conditions. The `ppi` stream is not comparable at any tau
(a derived interval series, white-frequency at ~5 s).

## The existing suite could not see the bug this fixes

`identify` was tested only on white PM (resolves) and white FM (declines). **The `flicker-phase` outcome
was asserted nowhere**, so an implementation answering `white-phase` for anything on the ambiguous arm
passed everything. Confirmed by mutation rather than claimed:

    resolved = _PHASE_MDEV_NAMES[0]        # always "white-phase"
    -> 77 pre-existing tests PASS, 2 new tests fail

A Voss-McCartney flicker-PM generator supplies the missing half. Two further mutants, both killed by the
test written for them: TDEV read at the stream's own tau instead of the named one, and `nightqc` dropping
the tau argument (silent — the record stays well-formed with `tdev: None`).

Not claimed: any change to what ADEV reports, to `classification`, or to `ok`. This publishes an answer
the module already knew and no consumer could see.
