---
bump: patch
type: fixed
brief: none
---

Declare each OxyDex metric depth in the published vocabulary. Twenty entries named
`secondary`, which is the tier attribute that `advanced` maps to and not a depth. The
engine coerced them to `advanced` without a warning, so the tier was right and the
declaration was wrong. A new suite group holds every registry to the vocabulary, and
two suite legs that read an absent key now examine all eight nodes.
