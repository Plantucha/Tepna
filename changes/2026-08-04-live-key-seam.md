<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [capture-host]
brief: CAPTURE-HOST-MUTATION-FLEET-2026-08-04-BRIEF.md
---

capture-host: pin `_live_key`'s device-qualification asymmetry — the seam behind issue #410, where two
devices streaming `ppg` collided and the Verity's card showed the ring's battery. Also corrects the
fleet brief's top recommendation: `run_polar`'s "100% concentration" was an artifact of measuring at
function granularity on a 1,900-line function.
