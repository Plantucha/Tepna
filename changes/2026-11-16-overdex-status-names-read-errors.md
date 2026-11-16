---
bump: patch
type: fixed
brief: none
---

OverDex now names unreadable files in its status pill after a drop. The pill counted four of the five file classes and left out read errors and refused seals. A failed read now draws the red pill, because the `err` tone had no CSS rule and drew the neutral one.
