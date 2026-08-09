---
bump: patch
type: fixed
brief: MOTIONDEX-RESPIRATORY-RATE-2026-07-21-BRIEF.md
---

The respiratory-rate Bland–Altman drew bias −0.42 with ±1.96·SD at +4.17/−5.00 as three horizontal
lines across a cloud whose difference depends on the magnitude with slope −0.891 (t = −49.4) — a fitted
bias running +5.41 br/min at a mean of 10 to −7.07 at 24, a swing wider than the interval those lines
claimed to bound. The limits now follow the regression (Bland & Altman 1999 §3.2), clipped to the
observed range, and the plot publishes which form of the limits it used.

The §5.3 varying-width band is computed and then REFUSED on this corpus: its own fitted |residual| line
crosses zero near 11 br/min, so it would claim zero-width limits — perfect agreement — at low rates.

`blandAltman` treated `null`, `''` and `[]` as a measured 0 br/min, because `+null === 0` and
`isFinite(0)` is true. 73 real epochs; as zeros they move the bias to −0.772 and the limits to
+6.10/−7.64.

Three figure defects: Y-axis ticks divided the range into fifths and printed to 1 dp, so evenly spaced
gridlines carried unevenly spaced numbers; the default formatter emitted an ASCII hyphen where the
limit labels beside it use U+2212; the per-night panel had no x tick labels, so its outlier could not
be identified.

New: `proportionalBias`, `refInBand`, `agreementSensitivity`, `trivialBaseline` — the last because a
CONSTANT 16.3 br/min scores MAE 1.39 against the estimator's 0.95, which retracts the "performing at
the Rayleigh limit" reading of that headline.
