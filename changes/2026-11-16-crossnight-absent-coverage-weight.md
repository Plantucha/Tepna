---
bump: minor
type: fixed
brief: none
---

An absent night coverage no longer weighs a full night in a cross-night envelope.

`crossnight-envelope.js` read a `weightOf` of `null` as `1`, so a night whose provider could not
measure coverage outweighed a night measured at 90 % in every fit and aggregate the envelope runs.
The clamp already held a measured weight at the 0.05 floor, so only the absent arm took the other
direction.

Four layers move together.

- The envelope weights an unmeasured item at the 0.05 floor, raises `weightAbsent` on the series
  row, reports `lowQuality: null` and counts the population in `window.weightAbsentCount`. The item
  keeps its place in `window.count`, in the span and in every metric's `n`, because a filter moves
  the absence into the count and the published span instead.
- `oxydex-cross.js` and `cpapdex-cross.js` answer `null` from `nightWeight` for a night that states
  no coverage and no mask-on hours. A measured zero still answers the floor.
- `integrator-longitudinal.js` forwards the flag instead of deriving it from the number, and
  `seriesFor` hands it to a consumer beside the coefficient.
- `docs/CROSSNIGHT-ENVELOPE-SPEC.md` states the rule in §3 and gates it in §6.

The published `weight` keeps stating the coefficient the fits applied, because it is re-derivation
provenance: all eight node engines read `p.w != null ? p.w : 1`, so a published `null` re-fabricates
the full night one layer down. The absence travels on the flag. `weightAbsent` is additive and
optional, so the envelope shape holds at v1.0.
