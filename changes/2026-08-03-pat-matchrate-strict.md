---
bump: minor
type: added
brief: PAT-UNDER-PERBLOCK-ALIGNMENT-2026-08-02-BRIEF.md
---

`tools/pat-matchrate-strict.mjs` — measures PAT `matchRate` under a definition that can fail. The
shipped statistic's second stage compares each lag to a median computed from those same lags, so it
passes uncoupled input; the strict definition anchors each block's acceptance to the median of the
OTHER blocks and scores both against circular-shift surrogates of the real foot train. Measured chance
floor 6–9 % (vs 53–69 % reported for the shipped definition). No runtime module changes — `pat-gate.js`
and the shipped statistic are untouched, so no bundle moves.
