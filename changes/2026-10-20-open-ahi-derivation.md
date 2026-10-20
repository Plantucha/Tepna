---
bump: minor
type: added
brief: OPEN-DATASET-AHI-DERIVATION-2026-10-12-BRIEF.md
---

Derive an AHI per recording from the two annotated open mirrors with `tools/derive-open-ahi.mjs`. It reads its own xlsx, counts only scored sleep stages, and refuses an absent scoring by name.
