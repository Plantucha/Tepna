---
bump: patch
type: fixed
brief: none
---

Flatten the partial-escape detector regex in the suite, where a nested arm for a character class gave CodeQL two HIGH `js/redos` reports.
