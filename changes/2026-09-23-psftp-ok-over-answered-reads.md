---
bump: patch
type: fixed
brief: SAMPLE-VALIDITY-ENVELOPE-2026-09-17-BRIEF.md
---

The Polar offline pull publishes `ok` only over reads that ANSWERED. `manifest["ok"] = not short`
was computed over the files that were enumerated, so a session whose directory listing came back
TRUNCATED or RAISED reported success over a file set of unknown size. Neither absence reached the
verdict: `truncated_dirs` was recorded on the client and read by nobody, and a listing that raised
yielded size -1 and was dropped by an `s >= 0` filter. Both now travel beside the verdict as its
denominator, and the aggregate in capture.py PROPAGATES the per-session refusal instead of
recomputing `ok` from short-reads alone — including counting a session that returned no manifest at
all, which previously contributed nothing and read as clean.

ABSENCE-SURVEY row `polar_psftp.py:736` (aggregate-over-absence, high).
