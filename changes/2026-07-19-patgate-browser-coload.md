<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: none
---
Co-load pat-gate.js into the browser test lane — it was wired into run-tests.mjs only, so the PATGate promotion-gate group hard-failed in Dex-Test-Suite.html and its 17 assertions never ran there.
