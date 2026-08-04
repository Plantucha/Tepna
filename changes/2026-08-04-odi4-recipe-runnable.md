---
bump: patch
type: fixed
nodes: []
brief: PAPER-ODI4-REPRODUCIBILITY-2026-07-31-BRIEF.md
---

`papers/odi4-ahi-bias.html`'s stated reproduction recipe — "open odi-bias-analysis.html → Run SubjectA
corpus" — could not be followed, for two independent reasons, and both are fixed. The page read
`uploads/synthetic/`, which is gitignored, while the pinned corpus is committed at `uploads/`; on a
fresh clone the recipe fetched five 404s. And the built page set `connect-src 'none'`, so the browser
refused every fetch and rendered an empty table with no error a reader would see. Verified in a real
browser: 'none' gives 0 rows and 10 CSP errors, 'self' gives 5 nights, 5 rows, 0 errors. `'self'` is the
same posture `CPAPDex.src.html` already takes for the same reason and still blocks every remote origin.
Also decides the brief's central question: four detector vintages produce bit-identical ODI-4 on fixed
inputs, so the detector is excluded and the unpinned corpus is what moved.
