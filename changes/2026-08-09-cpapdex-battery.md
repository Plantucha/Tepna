<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [CPAPDex]
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---
A cpapdex battery — and the "least trustworthy number in the fleet map" turns out to be right, for a reason nobody had checked.

Full sweep: 819 tested, 331 killed, 0 invalid, 488 survivors → 40.4 %. ⚠️ `canary: NONE`, so the rate
is unguarded. The fleet map's 60-mutant SAMPLE predicted 40 % and the population came back 40.4 % —
the third file where sampling held (ppgdex 33→34.0, motiondex 37→37.3).

`JS-DSP-MUTATION-FLEET` called cpapdex's 40 % "the least trustworthy number in the table" because it
has the fleet's narrowest tag (8 groups, 3 killing anything) against the third-largest file, making
"the killers are outside the tag" a live hypothesis. IT IS NOT THE EXPLANATION, and the reason is a
one-line check nobody ran: `CPAPDex` publishes only compute/buildNightFromSets/_synthEdfSet — which
LOOKS surface-bound like ppgdex — but `CpapDsp` publishes 26 functions. The tag is narrow because the
TESTS are narrow, not because the surface is. This is the hrvdex shape: the handle already exists.

Sound families:

  detectDesats    5/5  controls    9 survivors →  4 distinguishable, 5 recorded
  detectBreaths   8/8  controls   14 survivors → 11 distinguishable, 3 recorded

Held back, each diagnosed:

  computeMetrics   0/4  the input needs `d.pressure` (an array) — a `{usageHours, fs}` object never
                        reaches the mask-on-latency scan or the fs divisor at all.
  oximetryLane     1 distinct/55  the `chan()` record shape is wrong, so every case took the
                        no-spo2-channel arm. Degenerate, and correctly refused.
  _synthEdfSet     1 distinct/19  the generator ignores the opts keys guessed for it; its real
                        parameter names have to be read rather than assumed.
  selfGateDesat    6/10  the pulse cases never cross SELFGATE.PULSE_* , and `p` is never null or
                        non-finite — the three-clause guard at L577 needs all three states.

⚠️ 132 of the 488 survivors (27 %) are in the module's OWN `selfTest`. Deliberately not a family:
killing them means asserting on the internals of a self-check, which pins the CHECKER rather than the
analysis — the same trade RUN-POLAR-MUTATION-STOP-HERE §4 refuses for tuning constants. Any future
"cpapdex is only 40 %" should carry that denominator note.

Ledger: clock 3 · ppgdex 41 · hrvdex 69 · motiondex 42 · cpapdex 8 = 163.
