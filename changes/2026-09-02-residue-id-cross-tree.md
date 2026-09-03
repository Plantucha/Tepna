<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [tooling]
brief: none
---
The residue ledger's uniqueness check asserted ids were unique within the file it could see — one tree.
A branch that appended `R7` while `main` had advanced to `R10` passed the full local gate 56/56, and
under a squash merge that row silently duplicates or overwrites. `tools/residue-ids.mjs` compares the
branch's ledger against `origin/main`: no colliding id, added ids extend main's maximum monotonically
(a gap is a deleted row, not a free slot), and no existing row removed or edited outside its state cell.
Wired into `npm run check` and the CI `static` job beside `commit-shape.mjs`, refusing on a shallow
clone or an unreadable base rather than reporting green about a population it never read.
