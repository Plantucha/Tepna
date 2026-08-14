---
bump: patch
type: added
brief: CROSS-DOMAIN-METHODS-FOLLOWUPS-2026-08-14-BRIEF.md
---

`tools/closure-tol-hac.mjs` — derives the 3-source clock-closure tolerance from the legs' own
PRECISION (Newey–West HAC standard error of each drift slope) instead of their MAGNITUDE.

The shipped rule is `max(5, 0.25 * maxleg)`. Its rationale — "a triple of weak fits is allowed a looser
closure than a triple of sharp ones" — is right in principle and uses the wrong quantity: magnitude is
not precision. HAC is the standard estimator for exactly "OLS slope uncertainty when residuals are
autocorrelated", which is the failure #1231 measured (naive OLS underestimates ~10x because consecutive
block offsets share the same wander).

MEASURED on 14 nights with three fitted legs: the magnitude rule closes 6 and voids 8; HAC at 1.96·SE
closes 12 and voids 2, identically at Bartlett lags 0/2/4/8 (median SE 9.68 → 11.79 ppm). That 12/2
split reproduces the bimodality #1231 predicted, reached from precision rather than tuned to it. The
voided nights are 2026-08-06 (51.5 ppm against a 41.7 bound) and 2026-08-10 (18.5 against 15.9).

THE CONSTANT IS NOT CHANGED, and two inconvenient results are why. (1) The previously recorded
`r = -0.238` between |closure| and leg magnitude does NOT reproduce here — it is `+0.460` on these 14
nights, against 0.298–0.353 for the HAC SE, so on this subset the OLD predictor tracks closure better.
Neither supersedes the other; n=14 cannot settle a correlation. (2) "Voids fewer" is not a criterion
either. The real argument is calibration: at 95 % a sound rule should void ~5 %; HAC gives 14 %,
consistent with two bad nights plus noise, while the magnitude rule gives 57 %, which is not credible
as "57 % of nights have a wrong fit".

Re-run when more nights carry the third leg — only 25 of 51 have a `PpgDexFinger` export and 14 of
those yield three confident fits.

⚠️ The closure triple is H10 ECG · Verity PPG · O2Ring FINGER PPG through PpgDex — **not OxyDex**, whose
export carries no beat series at all (only `spo2`/`hr`). A first attempt using OxyDex produced zero
fitted nights; that is the export boundary, not the sensor.

No runtime change: `integrator-dsp.js` is untouched, no bundle moves, no fixture is affected.
