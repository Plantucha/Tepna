<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [capture-host]
brief: none
---

capture-host: `storage_targets.due()` decides whether a nightly offload runs, and its tests checked
either side of every boundary without ever landing on one — 10:59 and 11:01 but never 11:00, always an
explicit `window_min` so the default was never exercised, and never a `last_run` equal to the window
opening. Five tests over those exact points. 10 mutants, confirmed by ID.
