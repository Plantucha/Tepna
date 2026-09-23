---
bump: patch
type: changed
brief: none
---

`briefs/RESIDUE.md`'s preamble now warns that a row generated from a script can ship literal `\uXXXX` text: a quoted heredoc passes a double backslash through, so the ledger gets seven characters where the author meant one. It renders wrong, greps wrong, and cannot be repaired afterwards — a row is never edited, and this is not the pointer exemption, which is permitted only because `residue-ids` can check it. Eight landed rows carry it. The fix is a single backslash or the character itself, plus a one-line assert before writing.
