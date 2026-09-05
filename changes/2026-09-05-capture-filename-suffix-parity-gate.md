<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [suite]
brief: O2RING-TIME-CAPABILITY-WIRING-2026-08-19-BRIEF.md
---
New `capture-host · filename-case · source-scan` gate: the emitted `_<TAG>.<ext>` set is read off `capture_filename`'s own call sites, and every comparison in every reader (root `*.js`, `tools/`, `capture-host/`) is checked against it in both directions — a lowercase suffix with no case-fold (the #2219/#2221 defect, which matched nothing on any real night) and an uppercase suffix no writer emits both red, with `file:line`; plant-tested in both languages.
