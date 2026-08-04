---
bump: minor
type: added
nodes: []
brief: WEARABLE-HOST-AXIS-FOLLOWUPS-2026-08-02-BRIEF.md
---

Answers the open per-night matched TCH comparison, and the answer is that it cannot be run on this
corpus. WEARABLE-HOST-AXIS-FOLLOWUPS section F3 reported PpgDex's three-cornered-hat sigma moving 2.71
to 3.44 bpm and correctly refused to attribute it, because the two runs covered different night sets.
The obstacle turns out to be worse than an unmatched set: of 40 trio nights, 25 carry
`quality.timingSource` -- the field the host-axis work added -- and 15 predate it and were never
regenerated. The split is perfectly confounded with date, every night from 2026-06-10 to 07-13 being
post and every night from 07-16 to 07-30 pre, so no subsetting separates code version from night.

The cohorts differ by 1.5 bpm of PpgDex sigma, which is larger than the 0.73 bpm shift being attributed,
so any median over this corpus tracks the mix and both published numbers sit inside that range. The
remedy is to regenerate the 15 stale nights, after which the comparison is matched by construction.

Adds `tools/tch-corpus.js`, a pure both-lanes module that computes the cohort split from a marker the
export itself carries, and wires `tch-multinight.mjs` to print the verdict before the medians it
qualifies rather than after. Four states, one of which licenses the number: homogeneous, mixed (pair the
nights), confounded (regenerate, do not subset), and unreadable.

Unreadable is the load-bearing state and it fails closed. An unmarked night's cohort is pre-host-axis, so
a reader that stops populating markers makes every night pre and the corpus reads homogeneous -- a green
verdict produced by reading nothing. That is not hypothetical: it happened on the first wiring, when
`runNight` rebuilt its row object and dropped the field, and a corpus measured at 25/15 printed "all 40
from one producing code version". Gated by 16 assertions with three mutants each confirmed to red. The
per-night sigma values are recorded in the brief so the next comparison is matched.
