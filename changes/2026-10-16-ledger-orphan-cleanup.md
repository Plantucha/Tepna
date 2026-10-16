---
bump: patch
type: fixed
---

Remove 17 orphaned mutation-ledger entries from capture-host/tools/mutate-equivalence.json.

The entries referenced code that no longer exists in the source files (verified by checking the before text against current sources). The tool already excludes orphaned entries from counts, so this is noise removal only.

Removed: clock.js (3), cpapdex-dsp.js (1), hrvdex-dsp.js (9), ppgdex-dsp.js (4).

RATCHET numbers lowered to match: clock.js 3 to 0, cpapdex-dsp.js 26 to 25, hrvdex-dsp.js 71 to 62, ppgdex-dsp.js 130 to 126. COARSE_TRIPLE_COLLISIONS for hrvdex-dsp.js 15 to 13.

Note: the re-verification document listed 18 orphans including one bonding.py entry, but that code still exists in the source, so I kept that entry.
