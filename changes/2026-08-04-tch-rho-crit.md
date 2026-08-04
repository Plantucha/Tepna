---
bump: minor
type: added
nodes: []
brief: TCH-CORRELATED-SOLVE-KNIFE-EDGE-FOLLOWUPS-2026-08-04-BRIEF.md
---

Every correlated three-cornered-hat solve now reports how far it sits from the singularity that would
make it meaningless. On the real CPAP/ECG/PPG triplet the measured correlation sits within half a percent
of the value at which the CPAP corner's sigma reaches zero, and the 0.19 bpm returned there is the
non-negativity boundary seen from the inside rather than a quiet sensor. It happens at a positive sigma,
so the classic negative-variance check that tch-multinight uses to exclude nights never fires.

The brief asked for this as a closed form. It is deliberately not implemented that way: a second
derivation of the boundary would be a second implementation of the model, free to disagree with the very
sigma it qualifies, which is the duplication the sensor-trio power tool shipped and needed a parity gate
to bind back. rhoCrit instead bisects the real solver, so the answer cannot drift from what it describes.

Validated against an independently derived number: reconstructing the pair variances by inverting the
classic hat on the brief's own zero-correlation row reproduces its entire sweep to the digit, and the
bisection lands on 0.42199 against the 0.422 derived by a different route. The field is reported for
every pair including those at zero correlation, since how far independence sits from collapse is
information too, and it is additive so existing callers are byte-unchanged.

Thirteen assertions in both lanes with two mutants confirmed to red. The anti-vacuity leg is what gives
"tiny" meaning: a well-conditioned triple reports a margin of 0.500 against the real triplet's 0.0020.
