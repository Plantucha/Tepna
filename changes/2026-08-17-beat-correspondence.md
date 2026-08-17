<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [suite]
brief: INTERDISCIPLINARY-LITERATURE-2026-08-16-BRIEF.md
---

The beat-correspondence audit - the measurement papers/dead-ends.html §2.7 names as outstanding - is
built, gate-backed, and run. `tools/beat-correspondence.mjs`: a banded Victor-Purpura edit distance on
beat trains (insert/delete cost 1, shift cost q*|dt|; 2/q is the explicit "same beat shifted, or a
different beat?" boundary), seeded by an interval-sequence NCC anchor, returning the ALIGNMENT - which
beats pair, which are insertions, which deletions - not just a score.

REFUSES RATHER THAN REPORTING when the answer would be the instrument: an optimal path that touches the
Sakoe-Chiba band edge returns ok:false ("a result piled against a window edge is the window"), as do
degenerate trains and an unidentifiable anchor.

THREE BUGS THE FIRST VERSION SHIPPED WITH, each caught by planted truth and each a brief-family lesson
re-learned in miniature:

1. The offset estimator was POISONED BY THE THING BEING COUNTED. Index-paired median: one planted
   insertion shifts every later pairing by a whole beat, 90 % of deltas land one RR off, and the median
   picks the wrong population (planted 1 insertion -> reported d=1, i=2). Fixed nearest-neighbour,
   which ignores indices entirely.
2. The estimated offset is the MEDIAN OF SAMPLED DELTAS, so one residual is exactly 0 by construction
   and matches at ANY q. Two "extreme q" test expectations were wrong before the code was.
3. The MOD-RR PLANE IS AN INTEGER AMBIGUITY, resolved the GNSS-§4 way: on a phone capture there is no
   shared clock, so the offset is knowable only mod one RR - the estimator landed on the PREVIOUS
   cycle's foot (44.6 ms where transit is ~400+). The tool now sweeps candidate planes (base +
   k*medianRR), scores each by VP distance, and reports the best-vs-second margin as the ratio test.

MEASURED on the wrist pair (H10 ECG x Verity PPG), both 2026-07 identifiable-anchor nights: indel rate
37.6 % / 43.6 % - AS UPPER BOUNDS UNDER A GLOBAL-OFFSET MODEL, and the tool's own machinery names the
confounds: beat counts matching to 0.06 % while the alignment path walks +-2000 beats mid-night
(asynchronous DROPOUT segments, not scramble), ~7 ppm inter-device drift over 7 h comparable to the
300 ms budget (residual max piles at exactly 2/q - the truncation signature), and a 1.2 % plane margin
on 07-09 (the ratio test does NOT confidently resolve that plane). Next steps stated in the brief:
per-window offsets, and the finger pair which is RESULT-IV's actual experiment.

Gated by `tools · beat-correspondence` (9 assertions, Node lane; browser SKIPs) driving the pure core
by value with planted truth. Selftest carries 12 more. No DSP, no bundle - the tool loads the shipped
ECGDSP/PPGDSP into a headless realm exactly as pat-matchrate-strict does, with the per-element relSec
guard copied verbatim (an array-level truthiness check propagates NaN into every downstream time).
