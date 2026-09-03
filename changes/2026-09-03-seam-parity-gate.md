<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [MotionDex, Integrator]
brief: none
---
MotionDex knew which estimator produced its respiration rate and no consumer could find out.

`motiondex-dsp.js` set `respRateMethod` on the effort summary, the node export block omitted the field
entirely, and the Integrator's MotionDex adapter branch then hardcoded `'chest-ACC (thoraco-abdominal)'`
over it — so a fusion could not attribute a rate to the estimator that produced it, and would have kept
saying `chest-ACC` if the node ever reported anything else. The tell was an **asymmetry**: the ECGDex leg
of the same function already read the node's declared method with a fallback. Two sibling call sites
behaving differently is evidence of a defect, not a design.

The export now carries the field and the adapter reads it, keeping the literal as fallback.

This is the third of three defects in one week with one shape — a value computed, exported, present
everywhere a grep looks, and read by nobody (`respRateBrpm` reached no fusion for a month one `if` away
from its consumer; `hostAxis` was measured and dropped). So the fix ships with a gate for the class,
`seam-parity`, which lives AT THE SEAM and reads both sides: a gate written in the producer cannot see
this, because the claim is about a file the producer does not read — which is exactly how that producer's
own source comment asserting the wiring stayed wrong for a month.

It is validated anti-vacuously against all three specimens at their pre-fix shapes; each reverts to a
red naming the offending file. Two blind spots found while building it are recorded in the group's own
comments: matching `respRate:` file-wide flagged a node that computes a rate its export never carries
(the identifier, not the capability), and the hardcode leg's first form was vacuous because
`summary.respRateMethod` on the assignment's LEFT satisfied its "reads a method" test.
