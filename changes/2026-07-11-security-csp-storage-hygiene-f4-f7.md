<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: security
nodes: [suite]
brief: SECURITY-REMEDIATION-2026-07-11-BRIEF.md
---
Add a browser-enforced Content-Security-Policy to every bundle (connect-src 'none'/'self' — F7) and suite-wide storage hygiene on top of v1.2.0's Phase A: drop the raw-recording localStorage cache (F4), a shared "erase all data on this device" control clearing every key + the Integrator IndexedDB (F5), and migrate() now deletes the legacy profile keys it folds (F6).
