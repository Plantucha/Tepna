---
bump: patch
type: fixed
brief: none
---

Let the doff-path drain settle and retry, bounded, when BlueZ refuses it with `InProgress` because the predecessor pull's teardown has not finished — 9 of 32 drains since 09-07 were refused that way and left fragments for a poller lap up to an hour away — and record the drain's outcome in `autopull` status so "nothing stranded" and "refused" no longer both read as zero.
