---
bump: patch
type: fixed
brief: none
---

Pin the three-field floor of the headerless ACC column map in PpgDex and MotionDex. A row with one or two numeric fields maps nothing, and the parser counts every such row in `_unmappedDropped`. Before this change, no assertion caught a lower floor, which drops every row and counts none.
