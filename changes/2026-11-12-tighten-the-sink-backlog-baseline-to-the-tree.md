---
bump: patch
type: changed
brief: none
---

Lower the `xss-sink-gate` whole-tree baseline from 207 to the 206 the tree holds. One sink left `pat-feasibility.js` under #4954, which replaced an `innerHTML` assignment with a text node. This changeset moves the number alone, and the gate's code, criterion and ALLOW table stay put.
