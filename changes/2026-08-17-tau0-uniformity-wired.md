---
bump: patch
type: added
---

**`_tau0_of` hands `allan.stability` the MEAN packet interval, and every estimator there then treats
the samples as evenly spaced by it. On the BLE arrival axis they are not.** `arrival_quality` now
publishes `tau0_uniformity` beside the curve it qualifies.

Measured over the real corpus once wired — 1008 rows across 2026-08-11..16:

| stream | n | ratio (mean ÷ median) | max_gap |
|---|---|---|---|
| Verity ppg | 598 | **0.87 – 1.23** | 9.3× |
| Verity mag | 255 | 0.54 – 1.07 | 1.4× |
| Verity acc | 87 | 0.92 – 1.16 | 3.2× |
| O2Ring `_DURATION_S` | 38 | 1.00 – 1.01 | 7.2× |
| H10 ecg | 12 | 1.04 | 11.7× |
| H10 acc | 12 | **0.98 – 0.99** | **9.9×** |
| Verity ppi | 2 | 0.52 – 0.97 | 1.1× |

Against **≤0.7 %** on the device-counter axis the JS lane feeds the same estimator — same code, same
vocabulary, opposite answer, because the series differ.

## What the error does, since it bounds the value

A **uniform** rescale of tau is a horizontal shift in log-log, so the **slope is invariant** and
`classify`'s noise type — the thing callers branch on — is **immune**. What moves is where a sigma is
*read*: `optimal_tau`, `tau_max`, and fixed-tau comparisons.

**`_TDEV_TAU_S` is the cost.** It is a FIXED tau chosen precisely so nights are comparable, and two
streams quoted "at 100 s" are not at the same 100 s when one tau0 is inflated 16 % by gaps. That is the
consequence a reader can act on; the rest is a caveat.

⚠️ **`ratio` and `max_gap` disagree in direction, and that is the point.** H10 acc reads **0.98** —
apparently even — with a **9.9×** worst gap. One long stall and many small ones give the same mean, so
collapsing the two into a single score loses exactly that stream. Kept separate deliberately.

**Reported, never applied.** The unbiased AVAR estimator for unequal spacing (Sesia & Tavella 2008,
`10.1088/0026-1394/45/6/S19`) is the principled fix and should FOLLOW this measurement, not precede it
— ALLAN-DEVIATION §4's rule, after the last two arrival diagnostics that shipped with thresholds both
fired on every stream of the first real night.

## The test that had to be added twice

⚠️ The first version passed while the wiring was **wrong**. A mutant feeding `p[1]` (the delays)
instead of `p[0]` (the sample instants) **survived** — both columns are floats of plausible size, so the
wrong one returns a well-formed answer about the wrong quantity. The fixture writes packets 77 ms
apart, so the median interval **is** the cadence (78.0) while the delay column measures **1** on the
same input; the assertion now pins that. Both mutants die: wrong column, and a fabricated
plausible-looking dict.

4 of 1008 real rows take the `None` path (too short to have a spacing), and a test pins that a refusal
survives the trip to the row — "perfectly uniform" would be a claim about an axis that is not there,
and 1.0 is the value a reader would least question.

`allan.tau0_uniformity` itself landed separately in #1429.
