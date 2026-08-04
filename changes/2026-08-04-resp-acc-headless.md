---
bump: minor
type: added
nodes: []
brief: MOTIONDEX-RESPIRATORY-RATE-2026-07-21-BRIEF.md
---

`tools/resp-acc-headless.mjs` drives `resp-acc-analysis.html` through its own UI under
Playwright/chromium, closing the brief's open "exercise the browser page end to end" item. The engine
(`resp-acc-analysis.js`) was covered in both test lanes while the page's ingest, grouping, FileReader
and table render were covered nowhere — an engine with a known-answer test behind a page nobody has
run. Verified on 4 hardlink-staged real nights: 1,464 epochs, 18 rows rendered, 0 console errors,
median self-noise 0.74 br/min. A tool rather than a gate, deliberately: it needs a gitignored corpus
and a browser, so CI cannot run it. It also surfaces a silent capture-format gap — `groupFiles()`
requires `_YYYYMMDD_HHMMSS_ACC.txt` and the capture host writes no separator, so a box-captured night
is invisible rather than skipped; the tool now prints how many ACC files name-match.
