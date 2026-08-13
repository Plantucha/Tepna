---
bump: patch
type: changed
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---

OxyDex `computeKarvonenZones` was the second PSEUDO-TESTED clinical formula in `oxydex-dsp.js` —
executed on every run, asserted by nobody. Now pinned against Karvonen itself (a zone edge is a
percentage of heart-rate RESERVE added back to rest, not a percentage of HRmax), including the
`z5.high === hrMax` identity that catches a %-of-HRmax regression, both sides of the hrRest gate
(80 here, not the 100 its sibling uses), and the two fall-through paths for hrRest. Verified by
re-applying 16 mutants to the function body: 16/16 killed.
