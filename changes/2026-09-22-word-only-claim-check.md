---
bump: minor
type: added
brief: PARTIAL-ADOPTION-DETECTION-2026-09-20-BRIEF.md
---

`tools/verdict-adoption.mjs` checks that a `word-only` row's claim still holds: a row asserting the verdict vocabulary in its tool is prose reds when the tool PRINTS a decision outside its selftest. The population is the rows that make that falsifiable claim (71 of 85) — a row conceding emission and explaining why it is not a criterion decision is outside it by construction — and it is published as an equality. Measured before shipping: 71 checked · 9 flagged · 0 false positives; the nine are in `WO_CLAIM_RATCHET`, debt that may only shrink.
