<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: PPG-SAMPLE-RATE-AND-PAT-2026-08-03-BRIEF.md
---
What PPG sample rate actually buys — measured, and the answer corrects a shipped brief.

SDK mode raised the Verity's PPG ceiling 55 → 176 Hz and it went into production on the strength of a
quantisation argument in `POLAR-PMD-COMMAND-SURFACE` §2.2a. **That argument was wrong**, and the code
already said so three lines away: `ppgdex-dsp.js:942` (`refineFeet`) interpolates each systolic foot to a
**fractional** sample index, so beat times were never on the sample grid.

Measured by decimating ONE night — the only control that holds subject, beats and physiology fixed;
a cross-night comparison showed a 35 % rMSSD change that turned out to be autonomic state:

* **rMSSD invariant 44 → 176 Hz** (37.8 / 37.8 / 37.7 / 37.8, identical beat count and mean RR).
* **PAT residIQR flat 25 → 176 Hz** (~18.6 ms), then a **cliff at 22 Hz** (40.4 ms); detection collapses
  entirely at 11 Hz. Measured with the repo's own `coupledPAT` and scored against `pat-gate.js`.
* **The extra rate IS used, it is swamped.** Solving `total² = phys² + sampling²` against the 18.6 ms
  physiological floor gives a sampling term of 35.8 → 3.7 → 1.7 ms at 22/44/176 Hz — falling exactly as
  physics requires, but adding to a floor an order of magnitude larger. 44 → 176 Hz moves the total by
  **0.28 ms (1.5 %)** for **1.81× the battery** (4.74 vs 8.60 %/h, measured from `LINK.csv` across
  consecutive nights; 21.1 h vs 11.6 h runtime).

**Verdict: floor 25 Hz, recommended 44–55 Hz, nothing above.** Do not sit at 25 — the cliff moves *up*
with heart rate, and this night rested at ~52 bpm. 176 Hz stays in production on the owner's call
(11.6 h is ample for a ~6 h night), not on the original argument.

**Sample rate is not what blocks PAT.** Every rate from 25 to 176 Hz clears the 60 ms precision bar and
the gate still fails, on **matchRate 28.5 % against ≥55 %** — caused by **430 ms of drift** walking the
lag out of the physiological pairing window. A 2× shortfall against a 1.5 % one.

§6 records five method errors, each of which produced a confident wrong answer with no error message.
The one worth repeating: **a flat result is not a finding until a positive control shows the measurement
can move.** Pushing the ladder to 22/11/5.5 Hz turned "nothing changed" into a quantified saturation
curve — and it took the owner's disbelief, not any gate, to prompt it.

Docs-only — no bundle, no `manifestHash` movement, no fixture re-recorded.
