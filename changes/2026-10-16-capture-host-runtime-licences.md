---
bump: patch
type: docs
---

# Capture-host runtime libraries get licence docs

RESIDUE `2026-10-12-four-capture-host-runtime-libraries-are-named-in-no-licence-doc`:
`capture-host/requirements.txt` declares four runtime libraries (bleak, PyYAML,
aiohttp, cryptography). Neither `THIRD-PARTY.md` nor `docs/COMPLIANCE/SOUP-LIST.md`
named any of them.

This change adds a runtime-libraries table to the capture-host section of
`THIRD-PARTY.md`, with each licence read from the installed distribution, and
the matching rows in `SOUP-LIST.md` §3.
