---
bump: patch
type: fixed
brief: none
---

`qc_verdict` no longer presents a **session-basis** coverage as the device's coverage. `summarize`
divides by the device's own recording extent where it can bound one and falls back to the SESSION span —
the union across every device — where it cannot, saying so per stream in `span_basis`. **That label was
published and no consumer read it**, so both kinds arrived in one `coverage` map as though they answered
the same question. They do not: one is *"did we receive what this device sent"*, the other is *"what
fraction of the whole session's elapsed time did this device's rows cover"*.

`coverage` now carries only `span_basis: "device"` streams; a session-basis one travels in
`coverage_session_basis`, and an unlabelled one in `coverage_basis_unknown` — its own bucket, because
absence of the label is not evidence of which denominator was used (§∅), and an older summary read back
by a newer reader is exactly where that guess would land.

**Nothing is deleted and no alarm moves.** `degraded` keys on `session_coverage`, which is computed
independently of whether a device span could be bounded, so the FAIL and its reason are identical before
and after — pinned by a control that passes on both sides.

⚠️ **THE CLOCKLESS-SPAN FALLBACK IS DELIBERATE AND STAYS.** I first built the obvious fix — null the
coverage when the span cannot be bounded — and reverted it. It breaks 24 tests, and one of them,
`test_a_clockless_file_falls_back_to_the_session_span_and_SAYS_SO`, exists to assert that behaviour with
the §∅ argument running the other way: *dropping such files would move the start later, shorten the span
and INFLATE coverage.* A registry keyed on the FIXTURE records the same thing. Overturning a written
decision is its own unit and belongs to the owner, not to a bug fix.

⚠️ **And the null would not have fixed the night that prompted it** — a fact I had already established
and half-reported. I verified that `degraded` keys on `session_coverage` and cited it as what made the
null SAFE; the same independence makes the null INEFFECTIVE here, because the FAIL comes through
`degraded` either way. **Same fact, two consequences, and I only reported the flattering one.**

The primary defect behind that night's number is filed instead:
`2026-09-25-coverage-spans-two-capture-sessions` — a night directory can hold two capture sessions, and
then `rows ÷ (rate × the union span)` = 0.47 for a device that recorded perfectly through one of them.
This PR fixes the CONFLATION; the multi-session span is untouched and stated as such.

Two plants (both fail against `origin/main`) and two controls — the alarm's invariance and the ordinary
device-basis path — which pass on BOTH sides. One fixture gained the `span_basis` production publishes:
a summary fixture that omits it was making an unlabelled-coverage claim, not a device-basis one.
