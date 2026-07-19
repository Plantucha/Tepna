<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: none
---
Co-load manifest-gate.js (+ the pure computeHash probe and the two tools/ sources) into the browser test lane — the FIXTURE-VERIFICATION-GATE legs were silently ⊘-skipping there instead of running.
