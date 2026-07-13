<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: security
nodes: [OxyDex, PpgDex]
brief: SECURITY-LEAK-HYGIENE-2026-07-13-BRIEF.md
---
Stop OxyDex logging the raw filename + raw CSV bytes to the console, and render PpgDex's error toast via textContent (kills an F3-class innerHTML sink).
