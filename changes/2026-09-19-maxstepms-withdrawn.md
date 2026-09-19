---
bump: patch
type: fixed
brief: none
---

Withdraws `2026-09-16-maxstepms-names-two-populations` and logs a narrower successor.

The row alleged that `maxStepMs` is reported by two instruments over different anchor sets with no
field distinguishing them, and asked for a comparability warning. Tracing disqualified the remedy and
found two overstatements.

`anchors` IS published by both sites — `trio-batch.mjs:1357` writes it per device and the node export
carries `hostAxis.anchors` — so the qualifier exists. And NO consumer compares. All three sites that
handle two `maxStepMs` values were enumerated: `known-clock-recovery.mjs:207` and
`experiments/known-clock/run.mjs:97` ratio the SAME anchor set against a perturbed copy, which is the
controlled use the statistic exists for; `pat-host-offset.mjs:499-500` emits both and computes nothing
between them. A warning against a comparison nothing makes is speculation dressed as coverage.

The fact that settles it: `AXIS_EVERY = 500` in BOTH `ecgdex-dsp.js:4448` and `ppgdex-dsp.js:545`.
Identical stride, so inter-node density differs only by sample rate (~3.85 s at 130 Hz against
~4-5 s), not by the 28.5x that produced the row — that gap is arrival-tool versus node-export, and
nothing juxtaposes those two.

`withdrawn` rather than `fixed`: nothing was repaired, the premise dissolved. Closing it `fixed #N`
would assert a repair that never happened.

The successor keeps the one exposure that survives — `pat-host-offset` emitting ECG and PPG max-steps
into one row read by a human, across a ~30 percent temporal density difference — and states its
magnitude as UNMEASURED, because a max is density-sensitive in principle and nobody has measured
whether 30 percent moves it enough to matter. That unmeasured size is the content of the row.

The mechanism is worth keeping regardless: anchor density governs `maxStepMs`, and the DENSER
instrument reports the LARGER step, because sparse anchors let short transients fall between them.
Anyone reasoning naively expects the opposite and concludes an instrument is broken.
