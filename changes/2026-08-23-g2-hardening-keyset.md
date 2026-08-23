---
bump: patch
type: fixed
brief: OXYII-ACQUISITION-CHARTER-2026-08-23-BRIEF.md
---

G2-HARDENING: one assertion on `make_row`'s key set closes the 12 dict-key mutation survivors. Every
consumer reads a row by subscript, so the key NAMES are the ledger contract — a rename passes the
module's own logic and breaks every reader.

Deliberately the whole set rather than twelve field checks: field-by-field re-states the
implementation, grows a line whenever the row does, and cannot catch an ADDED key. Verified by
re-application — three renames and one addition each fail it. A second assertion pins the key set
through a JSONL round-trip, since that is where consumers actually read it from.
