<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: []
brief: none
---
Mark the seconds the beat reference never scored on the four-corner night page. The page's chest
fault flag reads null on all 11 four-corner nights of the archive, because it keys on the shape of
the solved sigma, and the seconds that carry a median 87 % of the chest excess are the seconds the
beat reference never scored. The worker now counts those seconds per key set, and it keys the count
on the disagreement `trio-reference.js consensusPairs` already tests: a second carries a reference
value only when our ECG beat and the H10 firmware RR agree within 8 ms. The page prints the unmarked
count, the population and the share for the three-way key set the headline sigma rides and for the
four-way key set the four-corner panel rides, under one measured badge, and the export carries the
same numbers. A night with no beat reference states that reason and prints no share, because nobody
scored those seconds either way. The published sigma does not move.
