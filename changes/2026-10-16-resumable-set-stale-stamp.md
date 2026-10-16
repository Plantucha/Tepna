---
bump: patch
type: fixed
---
Do not resume a capture file-set with a stale stamp.

`resumable_set()` judged recency by filesystem MTIME, which a stored-session
pull can freshen without writing data. On 2026-10-14 a 06:31 O2Ring set was
resumed at 18:01 for a 21:53 session; the evening data wore the morning stamp
and banded to the wrong night. The guard refuses a resume when the stamp is
older than twelve times the resume window, minting a fresh set instead.
