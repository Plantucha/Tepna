---
bump: patch
type: fixed
brief: none
---

The diff-scoped mutation gate stops mutating functions a formatter only moved: scope is now the intersection of the changed lines with the functions whose AST actually differs from the base, so a file carrying one real edit beside a page of reflow scopes that one function instead of every function the lines touched. Comparison is full AST equality with no string blanking, so a changed log line or format string still scopes and a re-indented docstring does too; a module whose base revision cannot be read or parsed narrows nothing.
