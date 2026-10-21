---
bump: patch
type: fixed
brief: none
---

Read six further spellings of an argv flag read in `tools/argv-reads.mjs`. Of the 23 tools that
leave the abstention column, 21 name every flag they read and 2 take a bare token as data.
The argv-guard group's plant mask now skips a regex literal, so a quote inside one cannot
desynchronise it.
