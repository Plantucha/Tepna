---
bump: patch
type: fixed
brief: none
---

Write the literal NUL and EDF+ TAL control bytes in two tools as escape sequences so the sources are plain text rather than `data` (runtime output proven byte-identical both ways), and replace the analysis-tool selftest step's `found >= 10` floor — which saw 156 — with a grow-only ratchet that fails when the count DROPS.
