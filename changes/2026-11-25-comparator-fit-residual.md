---
bump: patch
type: fixed
nodes: [CPAPDex]
brief: none
---

The CPAPDex live-vs-SD comparator publishes no scale residual when the regression does not fit. A live channel with no variance fits no slope, and the card named that residual as a post-regression number. The degeneracy test in the regression is relative now, because an absolute floor missed a flat channel whose values are not exact in binary. The Bland-Altman figures read the raw differences, so each one stays measured.
