<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [analysis]
brief: none
---
The `No value crosses a worker boundary unread` gate now pins its own **population**. Its name is universal
and it examined **one** producer with no denominator assertion at all; a floor can never detect exclusion,
because the excluded members are exactly the ones it does not count. The set of worker producers outside the
gate is now an **equality** against declared exclusions, each carrying the reason it cannot be read, and a
new undeclared producer reds.

Extending it found a live defect on the first run, in the producer nobody was looking at:
`sensor-trio-worker.js` shipped `hrRatio` on its success payload and no consumer read it — the `vdCorr`
shape. Two blind spots had hidden it: the producer was outside the population, and the key extractor read
only `out.X =` assignments, which see 14 of 14 keys on `pat-feasibility-worker.js` but **7 of 21** on this
one, whose payload is mostly a `var out = { … }` literal — `hrRatio` among the 14 it could not see. The
extractor now reads both idioms at depth 1, so declaring a producer whose payload it cannot parse can no
longer report clean over a third of it.

`hrRatio` is deleted from the success payload rather than surfaced, following this gate's own `detailCorr`
precedent; the skip path keeps it as a machine-readable field. The richer option — surfacing it as the
evidence behind "both gates ok" — is recorded as residue rather than decided here, since it is a surface
decision on another session's page.
