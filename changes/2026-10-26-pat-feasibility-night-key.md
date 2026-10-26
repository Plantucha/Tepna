---
bump: patch
type: fixed
brief: FILENAME-STAMP-JS-CONSUMERS-2026-10-20-BRIEF.md
---

The PAT feasibility page keys a night on the first data row. The stamp in a capture filename is
written when the host opens the session, before the connect, so a recording that starts hours later
landed on the wrong evening, and the page picked every companion by name proximity. A file whose rows
carry no stamp keeps the filename key, and the ingest note says how many did.
