---
bump: minor
type: added
brief: POLAR-ONBOARD-BACKUP-FOLLOWUPS-2026-08-11-BRIEF.md
---

Worn detection is now THREE detectors behind one combiner, because one detector with one calibration
domain left the rate this box actually runs with no verdict at all — and no way to tell.

**The damage was the silence, not the refusal.** `optical_worn` correctly refuses outside 55 Hz
(#1171), so at 176 Hz it abstained on every window. But `_set` only ever UPDATES and the caller
skipped publishing on `None`, so the LAST verdict stood: measured 2026-08-13, the card read
`worn: True` for **ten hours** while the armband streamed **496 MB into a desk**, with
`drop_not_worn_sec` armed at 180 s and structurally unable to fire. `_publish_worn` now takes
`bool | None` and publishes the abstention, clearing both the stale verdict and any running not-worn
clock — a grace period started under one detector must not keep counting after that detector stops
speaking.

**The new detector exists because THE PEGGING INVERTS BETWEEN THE TWO RATES**, which is why this is a
second calibrated detector rather than a widened threshold:

    55 Hz   worn = DARK (|median| ~1e2)      unworn = pegged bright ~3e5, and pegged is QUIET
    176 Hz  worn = PEGGED ~6.5e5 and QUIET   unworn = unpegged room light, and that is NOISY

So the LEVEL separates at 55 Hz and the VARIANCE separates at 176 Hz, and each is blind at the
other's rate. `ambient_stability_worn` covers 176 Hz: measured over 90 windows of 30 s from 15 real
files, ambient SD is **32.0–36.7 worn** (n=54) against **141.4–30 399.3 desk** (n=36) — a clean 3.9x
gap whose geometric midpoint is the threshold (72.1 → 72), the same rule that produced the 5000.

⚠️ Its provenance is **weaker than the 55 Hz constant's and says so in the source**: 90 windows across
15 files with worn/desk inferred from capture time, against 5730 windows across 45 files whose state
was known independently. The inference is corroborated by an independent statistic (per-file
cardiac-band power differs 20–100x between the groups), but corroboration is not knowing.

⚠️ **A CARDIAC-BAND DETECTOR WAS TRIED AND REFUTED — the refutation is recorded so nobody re-derives
it.** It is the attractive idea, and on two hand-picked windows it showed a 94x separation. Over 474
corpus windows at 55 Hz, **468 fall in the overlap**: worn median 0.026 against unworn 0.013, and the
unworn MAXIMUM (1.088) exceeds the worn maximum (0.882). Even at 176 Hz worn reaches down to 0.00089
while desk reaches up to 0.02234. An unworn sensor has ample 0.7–3.5 Hz energy from room-light
flicker, handling and drift, and normalising by total power rewards a quiet drifting signal.

`worn_verdict` combines whatever is available and in domain, and is **asymmetric on purpose**: worn if
ANY detector says worn, not-worn only if every opinion agrees, `None` when nothing is in domain — a
false not-worn drops a live link mid-night and costs a recording, a false worn costs a charge. It
returns the reason, naming which detectors voted, so "no verdict" is visible rather than silent.
`sd_calibrated_for(None)` is False where `calibrated_for(None)` is True: the older function's
concession to callers that predate the parameter is not inherited by a new detector.

**The regression test is written the only way that can fail.** `st.get("worn") is None` passes both
when None was published and when nothing was published at all, so the existing undecidable-window test
could not distinguish the fix from the bug — verified by re-applying it: that test PASSES under the
mutant. The new test publishes a `True` first and then abstains, so the assertion is reachable only if
the abstention actively overwrote. Red-under-mutant, green-restored.
