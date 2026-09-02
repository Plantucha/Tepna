<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: CPAP-EAGER-START-2026-09-01-BRIEF.md
---
capture-host: the CPAP false-start discard path named `[None]` instead of its artifacts — the raw record was filtered out because it publishes `_path` rather than `path`, the EDF had no name yet because the snapshot ran before its first batch, and the resulting `unlink(None)` raised a TypeError that escaped the loop's guard and would have killed the auto-start task for the rest of the night on the first false start. Paths now resolve when asked, a falsy path can never reach `unlink`, and the acquisition-evidence sidecar is removed with the fragment it describes.
