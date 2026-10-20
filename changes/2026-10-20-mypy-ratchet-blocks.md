---
bump: patch
type: fixed
brief: PYTHON-TYPES-AND-FORMAT-2026-08-27-BRIEF.md
---

Fail the capture-host gate when the mypy count rises above its baseline, which has been zero since 2026-10-09. The CI ratchet now reads that baseline from the constant, not from a comment quoting an old value. The gate's verdict object also carries a contract for the blocking format leg.
