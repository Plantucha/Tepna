---
bump: minor
type: added
brief: SENSOR-TRIO-NIGHTS-PAPER-BRIEF.md
---

**A reference-free σ is not a number — it is a number per window length.**

`tools/tch-window-sensitivity.mjs` decomposes why the fused-weight hat's re-fit does not reproduce the
published Verity/H10 σ. The dominant term is not the Verity corner: **σ rises monotonically with how
much of the night reaches the hat, for every corner** — Verity 2.36 → 3.51 (+49 %), O2Ring 2.34 → 2.99
(+28 %), H10 1.41 → 1.78 (+26 %) from a 1-hour window to a whole night, same nights and same estimator.

Neither σ-paper states window length as a parameter, so two honest analysts with the same devices and
nights can publish σ differing by half again. This is `CLAUDE.md` §7's rule for `hostAxis.ppm` ("never
quote ppm without the span beside it") arriving at the σ layer.

Secondary axis measured: nights where Verity tracks the chest ECG (r ≥ 0.70) give σ_Ver 2.72 vs 3.91
for decorrelated nights — a quality gate lowers σ by selection, not measurement. Pooling ruled out
(4.15, higher than median-over-nights). The residual is **not attributable**: the papers' corpus is not
re-derivable here, so corpus and method are confounded, and the tool says so rather than naming a cause.
