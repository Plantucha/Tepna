---
bump: patch
type: fixed
brief: residue 2026-09-10-ring-fileset-fragmentation-decayed
---

A reconnect that crosses midnight no longer mints a fresh file-set. `night_dir()` rolls by the
session's start date, so at 00:00 the folder changes under a recording that never stopped — and the
resume search read only one directory, so a device reconnecting at 00:01 looked in the new, empty
folder, could not see the set it wrote at 23:58, and started a new one. Measured over the corpus:
16 of 29 sub-5-minute seams straddle a folder boundary.

`resumable_set` replaces `resumable_stamp` and searches the previous day's folder as well, returning
the directory alongside the stamp. Both halves are adopted or neither: a resumed set is appended to
where it lives, because taking yesterday's stamp while writing into today's folder would put one set
name in two directories — one recording split across two places, which reads as a single set to every
name-keyed consumer and is worse than the fragmentation being fixed.

Rolling the folder at noon would also close the seam and was rejected: it changes where every future
file lands while the existing corpus keeps the old layout, leaving every reader with two conventions,
and it silently re-points the folder-name-derived dates in `nightqc` and `timeline.build`'s pooling
gate. This changes no layout, no folder name and no filename.
