<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [GlucoDex]
brief: none
---
Protect a gradual Level-1 nocturnal hypoglycemia (54-70 mg/dL) from the compression-artifact rule — the `_looksLikeGenuineHypo` depth gate short-circuited on `lo > 60` before the edge-steepness discriminator, so a real basal dip whose nadir sat in the shallow 61-70 band was flagged COMPRESSION and erased from min/TBR/LBGI/nocturnalHypo; now the near-vertical single-cell edge test is the sole discriminator.
