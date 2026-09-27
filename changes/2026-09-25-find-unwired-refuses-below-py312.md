---
bump: patch
type: fixed
brief: none
---

`tools/find_unwired.py` now REFUSES (exit 2, reason printed) under Python < 3.12 instead of reporting false orphans. Its consumer corpus drops every `tokenize.STRING` token, and before PEP 701 an f-string is one such token, so a call made inside one (`cpap_spool.py`'s `compact_cursor`) vanished and read as test-only: 2 false orphans under 3.11, 0 under 3.13. The floor is declared where the dependency lives (`PY_FLOOR`), the check is a pure helper exercised on both sides by tests, and `main()` refuses in every mode before scanning. Closes residue `2026-09-25-find-unwired-verdict-depends-on-the-interpreter-version`.
