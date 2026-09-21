---
bump: patch
type: fixed
brief: none
---

**`PAT Feasibility.html` was never in `build-analysis`'s `TOOLS`, so the box could not serve it.**
It was a hand-copied page from 2026-07-25 that loaded `pat-gate.js` and `pat-feasibility.js` from the
served root, whose worker then `importScripts` seven more modules — and the box's `sync-apps`
deliberately serves only owned output, so every one of those scripts 404'd there and the monitor's
PAT click could never process, even after #2736 and #2737 made the tool read box filenames and pair
the right sessions. `pat-feasibility-worker.js` had carried the comment *"DEAD in the build-analysis
blob"* since it was written: built to be inlined, never listed. `sensor-trio-power-analysis.html` was
listed; PAT was not.

One line in `TOOLS`, one rebuild: `verify:analysis` reads **12 checked, all self-contained** — both
scripts inlined, both workers as blob URLs with their deps pre-inlined, 916 kB. The serve whitelist
is not widened; that was the wrong fix and Wren said so.

Also: the docstring of `test_the_tool_classifiers_accept_box_filenames` quoted a regex in a non-raw
string — one `\d`, twenty SyntaxWarnings per run on main. Raw now.

Fleet-Session: Magpie
