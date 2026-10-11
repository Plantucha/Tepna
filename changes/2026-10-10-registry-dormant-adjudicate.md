---
bump: patch
type: fixed
brief: none
---

Adjudicate three of the five ids #3369 had recorded as "dormant" inside the resolvability gate's not-yet-adjudicated baseline — two get a declared nested binding (`emittedAt`, validated by walking the path on a committed export) and `crCoupling`'s alias is re-pointed to `crcPLV` with the duplicate id removed — and fix two defects in that gate: a label-order-dependent extractor that hid 24 of 522 ids, and a dormant-entry window that could read a neighbour's flag.
