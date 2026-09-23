---
bump: minor
type: added
brief: none
---

`tools/corpus-scope.mjs` counts a file pattern across every root `docs/CORPUS-LOCATIONS.md` documents and prints the scope beside the number: a root that is not on this machine counts `null`, never `0`; an elided or remote row is named as not countable rather than dropped; roots that alias or nest inside one another are shown but summed once; and a run where nothing is countable emits `UNDERPOWERED`, never a zero-file `PASS`. Closes the shape behind residue `2026-09-05-triage-stamps-searched-the-repo-tree-only`, where two stamps counted only the repo's `uploads/` tree and reported a data absence that stopped work on four briefs.
