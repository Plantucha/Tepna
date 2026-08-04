---
bump: patch
type: changed
nodes: []
brief: PAPER-ODI4-REPRODUCIBILITY-2026-07-31-BRIEF.md
---

Closes PAPER-ODI4-REPRODUCIBILITY, whose five remaining checkboxes were stale: the pinning, the Table 1
correction, the recipe fix and the known-answer gate all landed on 2026-08-03, but the brief still
advertised them as open, so the next reader would re-derive work already done.

Verified independently before closing. All ten artifacts are tracked at uploads/ (five O2Ring CSVs and
five ground_truth JSONs), the pinned bytes hash identical to the scratch copies, and a separate headless
realm reproduces the published Table 1 exactly on all five nights.

Adds the one thing that was asserted rather than computed. The paper states that Table 1 stopped
reproducing because the inputs changed, not the detector. Holding the bytes fixed and varying only the
detector settles it without needing the lost corpus: the 2026-07-31 detector and the current one agree
to the digit on identical bytes (17.7, 33.1, 2.4, 0.9, 0.8), and both are apparatus-controlled, each
reproducing the GATE-B-verified OxyDex 2026-06-13 summary at odi4 1.9. So the detector explains none of
the movement, while the files' mtimes show them rewritten on 2026-08-01. Candidate (b) is excluded by
measurement rather than by argument.

Notes in passing that the brief's own "today" column is itself now irreproducible, since the bytes behind
it were overwritten a day after it was written -- the brief documented the drift and was then subject to
it, which is the case for pinning in one line.
