<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [CPAPDex]
brief: CPAP-REAL-CORPUS-2026-07-11-BRIEF.md
---
The CPAPDex demo had never worked for anyone but the maintainer — it fetched ten **gitignored** real recordings.

`DEMO_FILES` listed ten real AirSense `.edf` files. They are personal recordings, so they are
gitignored, so on **any fresh clone every fetch 404s** and the demo dies with *"Demo data unavailable
in this build."* The button is present, the click throws nothing, and nothing happens. Anyone who
downloaded this repo and pressed Demo on CPAPDex got a dead page.

This is **`CPAP-REAL-CORPUS` §M5's disease on a user-facing surface**: a thing that only works where
the personal data happens to sit. §M5 found it in the equivalence gate (every node's input was a real
recording, so CI never ran the diff); this is the same root cause in the **demo**.

Two gates should have caught it and did not, which is the part worth recording:

- The **headless suite** cannot — a demo is a browser surface.
- The **browser render-coverage lane** has a CPAPDex rig that asserts exactly this (results view
  revealed, numeric cells, event rows, charts) — but its assertions **were not running**. It took
  `GATE-INTEGRITY-AND-DEVLOOP` ("stop the gate shrinking in silence") to make them run, at which
  point CPAPDex went straight to **7/13**. The bundle had not changed at all; the gate had simply
  stopped hiding it.

Fixed by pointing `DEMO_FILES` at the **committed synthetic EDF set** (`uploads/20260613_231433_*.edf`,
from `tools/make-synthetic-edf.mjs`) — closed-form waveforms calibrated to the corpus's distributions,
carrying no recording of any person and no device identifier. §P2 had already built and committed it
for exactly this reason; the demo just never used it.

Verified on a tree with **no personal data present** (a true fresh-clone state): CPAPDex render
coverage **7/13 → 13/13**, dashboard 1554 → 6084 chars, and `Dex-Test-Suite.html?full` reports **all
green** (2441 passed, 0 failing, 11 render groups, no boot skips) — where `origin/main` @ v1.8.0 is
**red**.

Rule going forward: **a demo must not depend on anything gitignored.**
