---
bump: patch
type: fixed
nodes: []
brief: MOTIONDEX-RESPIRATORY-RATE-2026-07-21-BRIEF.md
---

§11.7 said the respiratory estimator's banded output was "not a resolution limit but a structured bias,
mechanism unknown". Every clause of that was wrong, and it is corrected rather than amended.

It is two-stage quantization, and both stages were written in source comments the whole time.
`respGrid()` constrains the Viterbi ridge to RR_F_STEP = 0.004 Hz — a 0.24 br/min lattice, whose own
comment reads "spectral grid (~0.24 brpm)" — and `motiondex-dsp.js:935` then rounds the output with
`Math.round(v.rr[i] * 10) / 10` to 0.1 br/min. A 0.24 lattice rounded to 0.1 gives gaps of 0.2/0.3
where consecutive points are visited and 0.48→0.5 / 0.72→0.7 where one is skipped; 0.48 + 0.72 = 1.20,
the observed period. `looBias` then adds a different non-round constant per night, so pooled across
seven nights the lattice disappears entirely — 100% of per-night gaps are exact 0.1 multiples while 0%
of pooled values are, because differences survive a constant shift and absolute positions do not.

The earlier grid test failed because its candidate list contained neither 0.24 nor 0.1 — it swept 0.25
and concluded there was no lattice. The candidates were guessed rather than read out of the source, and
a near-miss like that turns real structure into a confident negative.

The correction also computes the resolution floor properly, which reframes the result. The 60 s
analysis window has a Rayleigh resolution of 1.00 br/min; the grid samples that peak at 0.24 and the
output reports it to 0.1, so the published precision is 10x finer than the measurement supports and is
not a floor at all. Quantization is worth 0.075 br/min RMS — 0.10% of the error variance, moving RMSE
2.3800 to 2.3788 if removed entirely — so the estimator is deliberately left alone. The headline for the
three papers becomes MAE 0.95 against a 0.72 reference self-noise floor and a 1.00 br/min window
resolution: the estimator is performing at the limit of what a 60 s window and this reference support.

The MAE sitting essentially on the Rayleigh limit is suggestive, not established, so the falsifiable
version is routed to MOTIONDEX-RESPIRATORY-RATE-FOLLOWUPS §5 as a window sweep — with the warning not
to simply double RR_WIN_SEC, since a longer window trades against non-stationarity and the reference is
epoched at 30 s. Either outcome is informative: MAE tracking 1/T means the estimator is window-limited,
MAE flattening means no amount of spectral work will improve it.
