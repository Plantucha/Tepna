---
bump: patch
type: fixed
brief: none
---

`tools/analysis-rerun.mjs` drove the treatment-response rerun at the page's default minimum of 6
nights; the paper states 10 or more, and the difference changes who qualifies. The driver now passes
`minN: 10`, so a rerun reproduces the paper's configuration rather than the page's default. That is
the configuration `2026-09-17-papers-predate-134-detector-fixes` settled as the one that still does not
reproduce (233 + 239 against about 900 per arm); a rerun at the wrong filter would have hidden that
behind a different shortfall.

Fleet-Session: Magpie
