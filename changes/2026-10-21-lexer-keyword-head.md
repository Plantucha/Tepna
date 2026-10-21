---
bump: patch
type: fixed
brief: none
---

Open a regex literal in the shared lexer when the slash follows a keyword.

A regex standing after `return` read as division, and the first quote inside it opened a string
literal that ran to the end of the file. Sixteen of 463 shipped files carried that desync.

`tools/argv-reads.mjs` already held the keyword list in a second copy of the predicate. It now
imports the list from the lexer, and its own output over 259 tools stays byte-identical.
