---
bump: patch
type: fixed
brief: none
---

Count each file the citation scan cannot read as excluded, and name its path and its errno.
The scan skipped an unreadable file and reported `excluded: 0` over a population of citations.
The verdict now counts files, answers UNKNOWN when it could not read one, and exits 2.
