---
bump: patch
type: added
brief: PINNED-SPAN-POPULATIONS-2026-09-18-BRIEF.md
---

Measurement brief: a "pinned span" is three phenomena and `pinnedSpans` is rail-keyed, so it sees one
and a half. No detector proposed and none may be built from it until the owner answers whether
saturation is an absence — a saturated sample is a lower bound on the true value, not a missing one.

The structural finding is a maximum and therefore immune to the denominator problem: rail runs stop
at 179 samples, mid-range runs reach 27,478 (~3.7 minutes frozen at 125 Hz). The bulk of the
mid-range population is quantisation (p50 2, p99 19), so a >=5 rule would convict 12.6 % of signal;
the >=200 tail is 26 runs at 0.297 %.

Controls do not convict, at census rather than sample scale: ACC fires zero times at >=200 across
849,897,015 samples, longest constant run 172.

Carries a pre-registered branch that was called and then refuted by its own author: all 112 ECG runs
>=200 are saturation at each file's OWN rail (108 exact, 4 within 2 %, zero mid-range), so the freeze
phenomenon is not device-generic. Those 112 are recorded as a finding in their own right — real
saturation, unflagged today, in the stream whose purpose is beat morphology.

Every denominator is deduplicated with identity established by bytes (88 to 45, 1193 to 597, 4258 to
1925), two same-name ACC captures with differing bytes kept separate, and the brief partitions which
statistics duplication can move — maxima invariant, shares and percentiles not — verified by
re-measurement. PPG figures are a 45-of-3013 subset of the available population.
