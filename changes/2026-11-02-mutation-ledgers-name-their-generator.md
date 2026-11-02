---
bump: patch
type: fixed
brief: none
---

Make both committed mutation measurement ledgers name the generator that produced each number. A reader now treats an entry from another mutmut as absent, and a writer refuses an entry no reader can date.
