<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [capture-host, docs]
brief: CAPTURE-HOST-MUTATION-FLEET-2026-08-04-BRIEF.md
---

docs: rank all 19 measured capture-host modules and record what predicts a cheap mutation pass —
concentration, not module history. Finds ~1,150 reachable fleet-wide, with `capture.run_polar` holding
502 of them at 100% concentration in one function. Corrects an earlier note that implied 149.
