<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [docs]
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---
Replace the fleet map's sampled rates with measured ones — and record that the sampling failed twice, bimodally, always in the flattering direction.

Six files have now been swept exhaustively against their 60-mutant sample:

  ppgdex   sampled 33 %  measured 38.9 %   (−1.0 against the same code, pre-#1113)
  motiondex        37 %           37.3 %   −0.3
  cpapdex          40 %           40.4 %   −0.4
  pulsedex         42 %           25.5 %   +16.5
  glucodex         55 %           33.7 %   +21.3
  hrvdex           28 %           39.1 %   (different code — #1030 landed between)

THE ERRORS ARE BIMODAL, NOT NOISY. One SE on a 60-draw is ~6 points, so −0.3/−0.4/−1.0 is
suspiciously exact and +16.5/+21.3 is 2.7–3.5 SE out. Noise scatters; this splits cleanly into two
populations, and BOTH failures overestimate. The mechanism is unknown and this change does not invent
one — it records the data and marks the three unswept rows as estimates.

What follows from the data alone:

  · `ecgdex` (62 %) and `integrator` (68 %) are the two files no exhaustive sweep can afford, and they
    sit at the TOP of the sampled table — exactly where an optimistic bias would put a file nobody can
    check. Those rows are now labelled `unswept`.
  · The ranking was wrong where it mattered: glucodex and pulsedex ranked 6th and 5th BEST and are in
    fact the worst two measured.
  · "The sample held on three files" was never evidence that the sample holds. It was believed after
    three confirmations and refuted on the fourth and fifth — the same shape as §5's ~27 % ceiling
    generalisation and §3a's six-cluster claim. Generalising from agreement is this programme's most
    repeated error, and this is the third instance.

pulsedex's sweep (568 tested, 144 killed, 3 invalid, 421 survivors, canary NONE) is new here; the
other five were measured in earlier changesets.
