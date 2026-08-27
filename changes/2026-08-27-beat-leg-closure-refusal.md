---
bump: minor
type: changed
brief: CLOCK-LEG-SIGN-CONTRADICTION-2026-08-27-BRIEF.md
---

**`beat-leg-closure` publishes an uncertainty with every rate and REFUSES when that uncertainty is too
wide to be a gate input.** Implements the §9 follow-up: leg C printed a bare ppm, and on the
2026-08-13 night that number was not a clock measurement — the observable wandered ~450 ms while the
clock difference to resolve was ~102 ms, so the fitted slope reported the wander. Two fragments of one
night then disagreed by 40 ppm.

Additive fields only (`boundPpm`, `wanderMs`, `signalMs`, `residualMs`, `snr`, `spanMin`,
`slopeSpreadPpm`); a refusal carries all of them and **no `ppm` field**, so no caller can reach a
number on that path. Audited: exactly one file imports this tool and it takes only
`h10Beats`/`verityBeats` — nothing consumes `legC`'s return shape, so nothing breaks.

`BL_MAX_BOUND_PPM = 4` is a CONTRACT constant, not a fitted one — the geometric mean of the two
measured anchors (host-leg reproducibility ~0.35 ppm, leg-C failure scale ~40 ppm), overridable with
`--max-bound`, PROVISIONAL until a second corpus anchors it.
