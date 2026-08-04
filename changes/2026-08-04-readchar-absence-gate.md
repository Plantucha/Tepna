---
bump: patch
type: added
brief: CPAP-AUTOHARVEST-FOLLOWUPS-II-2026-08-03-BRIEF.md
---

`capture-host/tests/test_probe_read_char.py` — gates `probe_pmd_surface._read_char`'s absence-is-absence
promise with a fake client (no hardware). Executes §2, which the guarantee sweep had named as the one
function in the family whose docstring promise no test asserted. Mutation-verified: narrowing
`except Exception` to `except TimeoutError` kills 6 assertions; deleting the hex fallback kills 1.
