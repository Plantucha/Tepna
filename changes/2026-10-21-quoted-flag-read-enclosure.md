---
bump: patch
type: fixed
brief: none
---

Two source-scanning gate groups now decide a match by its enclosure. A tool source planted in a string literal no longer reads as the host tool's own code.

The documented-flag group tested both exclusion shapes with a plain match over text that still carried its literals. A tool that plants a composed flag read as classifier input read as a tool that composes one. It left the judged set for a reason untrue of it. That took the excluded set to 9 and the judged set to 223 over 280 tools.

The two numbers are now 8 and 224. The CLI-predicate group skipped that whole file by name for the same reason, so a real raw comparison in it stayed invisible. This drops the exemption and keeps the planted line as a live decoy. Both masks come from the one regex-aware lexer.
