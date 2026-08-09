<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [docs]
brief: O2RING-ADAPTIVE-TIMEBASE-2026-08-08-BRIEF.md
---
Design brief: adaptive O2Ring timebase (crystal 125.000 default, host discipline when stratum-1), with per-capture clock provenance.

125.738 is a row-rate fiction (125 + HR/60 from the inserted 156 marker) that contradicts the
manufacturer's documented 125.000; and the host clock is not universally trustworthy (stratum-3 out of
town vs stratum-1 at home), so disciplining the device rate to it can be worse than the device's own
±40 ppm crystal. The design defaults to the crystal and uses host discipline only when host_clock earns
it, stamping which clock governed each capture.

Crystal axis validated against the H10 chest ECG on a stratum-1 night (99.6% beat agreement): host and
crystal axes both match ECG to <=0.2 bpm and <=0.6 ms rMSSD, crystal marginally better. This corrects an
earlier confirm that wrongly called the crystal axis unstable (a naive pure-125 that discarded host
anchoring, not the crystal itself). Docs only — staged implementation follows.
