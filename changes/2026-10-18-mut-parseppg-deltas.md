---
bump: patch
type: added
brief: none
---

Adds one mutation-kill test for parsePPG. The test pins the zero-delta fs boundary at ppgdex-dsp.js:1537 (`d > 0`). Zero ns deltas stay out of the fs median. The mutant (`d >= 0`) survives the suite on main. This test kills it. Both verification runs happened 2026-11-09 at bfb3c3dd3.

The unit's second October target, the `deltas.length > 20` boundary, gets no pin here. The lazy-lastTs span fallback superseded its fs-at-default contract. Existing coverage already kills that mutant.
