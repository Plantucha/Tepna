---
bump: minor
type: added
brief: none
---

`tools/defect-pin-census.mjs` enumerates every in-tree annotation of a test that once asserted a defect. `tests/defect-pin-inventory.json` carries one entry per annotation, with its mechanism and one line of why. The gate reds on an annotation with no entry, and on an entry whose annotation moved. It reads the annotations rather than the tests, so its counts bound the class.
