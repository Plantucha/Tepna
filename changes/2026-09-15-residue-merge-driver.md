<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: []
brief: RESIDUE.md
---

`briefs/RESIDUE.md` was merged with `merge=union`, which appends correctly and cannot represent an
edit — so closing a row near the tail while another PR appended kept both lines, `OPEN` and `fixed`,
with no conflict raised. `tools/residue-merge.mjs` merges the file over row ids instead of over
bytes: it keeps the conflict-free append, takes whichever side actually edited a row, and refuses
when both sides edited one row differently or either deleted one. The driver is per-clone, and the
uninstalled state is the safe one — an unconfigured driver name falls back to git's built-in 3-way
merge, which conflicts on exactly the shape union duplicated.
