---
bump: patch
type: fixed
brief: TOOL-BUILD-STANDARD-2026-09-13-BRIEF.md
---

tools: `selftest-all`'s summary parser recognised one output format, so 22 tools that report an
assertion count were miscounted as printing none. Widening it to the formats the fleet actually
writes makes 441 more assertions visible (900 → 1341) and cuts the unparseable ratchet 48 → 26.
