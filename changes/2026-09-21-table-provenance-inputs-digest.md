---
bump: minor
type: added
brief: PUBLISHED-NUMBER-PROVENANCE-2026-09-15-BRIEF.md
---

A TABLE-PROVENANCE stamp can now carry inputsDigest= beside a resolvable inputs= path; the runner recomputes the digest over the git-tracked files under that path on every run and the gate compares, so a stamp over committed upstream CLEARS a churn flag rather than only raising one — the half of phase 2 that #2614 left out. First clearable stamp on the re-cut three-cornered-hat table over the 441 trio exports; a planted one-byte change to one export reds the leg by name. Blockquoted tables are captured.
