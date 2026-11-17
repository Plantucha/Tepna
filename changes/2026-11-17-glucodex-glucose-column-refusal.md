---
bump: patch
type: fixed
brief: none
---

Refuse a CGM export whose glucose column cannot be found, rather than read column 1 as glucose, and
read one numeric-cell predicate in both the column detector and the row parser.
