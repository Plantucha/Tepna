---
bump: patch
type: fixed
brief: none
---

`allan.noise_id` refuses when the identified power law falls outside the five it names, instead of
clamping to the nearest. The docstring justified the clamp with the right argument for the wrong
operation — "a sixth label would be invented rather than measured" — but clamping does not decline
to name it, it assigns the NEAREST of the five, so a series that is none of them was published as
`random-walk-frequency` with no mark.

⚠️ Not an edge case. alpha = round(-2*(rho+d)+2) with rho >= 0, so staying inside [-2,+2] needs
rho + d <= 2.25: EVERY series that needs d = 3 differences is unnameable, and `dmax` DEFAULTS to 3.
Measured — a 600-sample cubic decorrelates cleanly at d=3 (rho 0.0, raw -4.0) and was reported
random-walk FM. The bound is now keyed on `_ALPHA_NAMES` rather than a literal range, so it cannot
drift away from the labels it is about.

ABSENCE-SURVEY row `allan.py:655` (default-reads-as-measured, high).
