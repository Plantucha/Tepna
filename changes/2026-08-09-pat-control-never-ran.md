<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite, PpgDex]
brief: PAT-VERDICT-CONSOLIDATED-2026-08-04-BRIEF.md
---
Fix the PAT positive control, which referenced an identifier that never existed and had therefore never run.

`tools/pat-ppg-ppg-control.mjs` referenced `RE_WRIST` at :279, defined in NO revision of the file — added
by #936 under a `docs(pat):` prefix. It threw ReferenceError on the first night, every time. That tool is
the arbiter which decides whether any PAT verdict in this repo means anything, so no PAT conclusion here
has ever been backed by its control.

Adds five measurement tools and, with them, the first PAT numbers taken on box captures with a confirmed
independent second clock. No runtime code, no bundle, no ledger — analysis tools only.
