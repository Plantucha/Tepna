<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [GlucoDex]
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---
Bootstrap GlucoDex genSynthetic — it had 90 survivors and zero kills, which made all 90 unclassifiable by construction.

This group exists because of a limitation the programme found, not a defect in the code.
`tools/probe-equivalence.mjs` requires a positive control FROM THE SAME FUNCTION — a mutant the suite
actually killed, replayed to prove the battery reaches that code. `genSynthetic` had none, so the
probe reported NO CONTROLS and withheld all 90 verdicts even though its battery plainly reached the
function (52 distinct answers over 53 inputs).

A FUNCTION WITH ZERO KILLS CANNOT BE EQUIVALENCE-PROBED AT ALL: "0 % killed" and "100 % equivalent"
are indistinguishable to the tool, and the only exit is a test. This is that test, and its purpose is
to make the other 89 classifiable.

VERIFIED BY RE-APPLYING REAL SURVIVORS — 5 of 6 sampled genSynthetic mutants now die:

  L1528 opts = opts && {}                KILLED      L1530 profile = opts.profile && 'healthy'  KILLED
  L1529 days = opts.days && 14           KILLED      L1529 days = opts.days || 0                KILLED
  L1531 cadenceMin = opts.cadence && 5   KILLED      L1532 t0 = ... - days * 0                  survived

⚠️ THE GENERATOR IS UNSEEDED — gaussian noise and per-day meal jitter, no seed option — so every
assertion is STRUCTURAL or STATISTICAL. An exact expected series would be flaky, and a tolerance wide
enough to hide that would hide the mutants too.

One assertion was wrong on the first pass and the failure was informative: "every step is exactly
cadence*60000" failed on a cadence-15 day that contained a 105-minute gap. The generator DROPS samples
to simulate real CGM dropouts. The invariant that actually holds — and still separates a mutated
stepMs — is that every interval is a positive INTEGER MULTIPLE of the cadence: the grid survives the
gaps. Asserting the stricter thing would have pinned an accident of the sample rather than the design.

24 assertions covering all three options (days / cadence / profile), their `||` defaults, the
unrecognised-profile fallback, the mg/dL + synthetic labels, t0Ms ≡ tMs[0], strict monotonicity and a
physiologic range check.
