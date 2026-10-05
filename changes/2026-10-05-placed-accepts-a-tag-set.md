---
bump: patch
type: fixed
brief: none
---

The one place the night timeline compares a file tag now accepts a SET of them, so one configured stream can be written under more than one tag. `acc` arrives as `_ACC.` from the chest strap and `_ACCRAW.` from the ring, and `timeline._placed` compared the file tag against a single string — so the ring's 10,137,042-byte `_ACCRAW.txt` matched nothing and that device's whole night was painted `idle`, which is the one state that reads as a finding rather than a miss. A bare string is still accepted and behaves exactly as before, so every existing caller is unchanged; this lands the capability on its own, ahead of the callers that will hand it a tag set, because until it exists a caller passing one skips every file in the night rather than failing.
