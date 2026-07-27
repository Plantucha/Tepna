<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [Integrator]
brief: DEEP-AUDIT-III-2026-07-26-BRIEF.md
---
Three publications of agreement the Integrator never measured, all AUDIT-PROMPT class 11. Every `confirmed_apnea_event` hardcoded `OxyDex` as the desaturation observer — correct while the pool was node-keyed, wrong ever since DEEP-AUDIT-2026-07-11 §15 made it impulse-keyed — so findings credited a node that was not on the bus; the observing node is now carried exactly as the surge side already did it. `fuseRespirationRate` collected every record with a respiration rate from the whole loaded bus, so two ECGDex exports from two different nights were published as "2 independent estimates (ECGDex + ECGDex) … agreement within the ±2 br/min chest-ACC validation band"; it now fuses only within a temporally overlapping group and collapses to one observer per node, so `n` counts distinct sources. `fusePulseCrossCheck` took the first candidate of each kind and compared recordings nights apart while its own comment claimed "one session"; it now selects an overlapping pair. The guard deliberately rejects only PROVEN-disjoint records: HRVDex and GlucoDex declare no duration key at all (§6.2), so their window is unknown rather than disjoint, and rejecting them would trade a wrong number for a missing one — unknown windows still fuse and both blocks publish `overlapVerified` so a "one session" claim can be read for exactly what it is.
