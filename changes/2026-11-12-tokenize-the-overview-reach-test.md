---
bump: patch
type: fixed
brief: none
---

Tokenize the overview reach test in the suite, where a `$`-only escape of an extracted name reached a `new RegExp`. A token set needs no escape, and it also sees a `$`-leading name that the word-boundary form missed.
