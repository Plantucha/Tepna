---
bump: patch
type: fixed
brief: briefs/PYTHON-TYPES-AND-FORMAT-2026-08-27-BRIEF.md
---

**A property test read its condition off a ROUNDED field, and it was a latent flake on `main`.**

`test_span_is_never_negative_and_a_zero_span_refuses_the_RATE_not_the_offset` asserted
`reason == "no-span"` whenever the reported `span_s` was 0. But `span_s` is reported as
`round(raw, 3)` while every branch inside `as11_clock.analyze` tests the **raw** value. Two host
stamps 2.4 × 10⁻⁷ s apart therefore report a span of `0.0`, sail past `if span_s <= 0`, and refuse
the rate one line later as `too-few-for-rate`.

Both are correct refusals — `slope_ppm` is `None` either way, so **no wrong answer ever reached a
caller**. The test was wrong about the code, not the other way round: it read the condition off a
rounded field and then asserted which branch had been taken on the unrounded one, pinning an
implementation ordering the contract never promised. The condition now comes off the raw host span.

**Why it is worth a changeset rather than a quiet edit:** hypothesis draws a new random sample every
run, so this would eventually have reddened some unrelated PR's CI with nothing in that PR's diff to
explain it — the most expensive kind of failure to diagnose, because the evidence points at an
innocent change. It surfaced here on the third launch of an unrelated gate, and only because the
first two launches were killed by the box and had to be re-run.

Verified the guarded branch is **reached** rather than merely passing — 52 entries in 400 examples,
so the property is not vacuous — and the file passes under four independent hypothesis seeds, 13/13
each. A property that never enters its own conditional is a test that cannot fail.

⚠️ **Noted and deliberately NOT fixed here**, for whoever owns the clock surface: a sub-quantum span
makes `ppm_floor = quantum / span` astronomically large, so `minute_is_real` is trivially `True` for
any slope at a span of ~10⁻⁷ s. Whether `analyze` wants a minimum-span guard is a behaviour change,
not a test fix — and the Clock Contract's §7 takes a deliberate position against span-gating the
sibling `hostAxis`, which should be read before anyone adds one here.
