<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [PulseDex]
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---
Bootstrap PulseDex fragmentation — the third and last zero-kill function. All 163 previously unclassifiable survivors are now probeable.

The zero-kill class is closed:

  glucodex  genSynthetic           90 survivors  →  bootstrapped (#1125), 5 of 6 sampled now die
  pulsedex  compareIntervalSeries  54 survivors  →  bootstrapped,          3 of 8 sampled now die
  pulsedex  fragmentation          19 survivors  →  bootstrapped here,     4 of 8 sampled now die

A function with no kills has no positive control, so the prober withholds every verdict however good
the battery is. That made 163 survivors — 12 % of everything the fleet has mapped — permanently
unclassifiable until a test existed. Three tests, and they are now ordinary probing work.

DERIVED, NOT PINNED. Unlike the other two this function is exactly hand-computable, so every
expectation comes from the definition: PIP counts sign changes in the successive differences (carrying
the previous sign across a zero) and divides by N BEATS, not by the difference count.

  alternating × 5   3 changes / 5 beats  = 60 %
  alternating × 9   7 changes / 9 beats  = 77.8 %     ⟵ 7/8 would be 87.5, so this separates the
                                                        denominator from a mutated one
  one turn          1 change  / 5 beats  = 20 %
  monotonic, flat   0 changes            =  0 %

The monotonic and flat cases reach zero by DIFFERENT paths — monotonic has all-positive signs, flat
has all-zero differences whose sign is carried from the previous one. A mutant that drops the carry
turns the flat case into noise while leaving monotonic intact, so both are asserted, and a third
assertion pins that they agree on every index rather than merely on PIP.

Verified by re-applying real survivors: 4 of 8 sampled now die, including the N<4 floor, the
difference loop bound, the zero-sign carry (`s[i] === 0` → `!==`) and the inflection loop bound.

⚠️ The sweep's line numbers were stale again (#1127 moved the file), so the verification re-anchored
each survivor by unique (op, before) first — 19 → 17 uniquely re-locatable, and only those applied.
Second time in one session that the anchor decay bit; `tools/reanchor-equivalence.mjs` exists because
of the first.
