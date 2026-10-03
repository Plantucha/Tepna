---
bump: patch
type: fixed
brief: none
---

The Vigil Nights page is readable again. `nights_index`'s per-file cache was keyed on size + mtime
alone, and a captured file that has stopped growing never changes either — so every entry the
pre-#3233 build wrote for a finished night stayed a cache hit while lacking the `gaps_s` key that
#3233 added, and the whole index raised `KeyError: gaps_s`. The page read "no nights on disk" for
about 3.5 days.

An entry's SHAPE is now part of its key: `_STATS_SHAPE` fingerprints `_STATS_KEYS`, so an entry whose
shape this reader does not produce is a MISS and is recomputed from the file on disk. The magnitude
exists, so recomputing it is the honest answer — publishing null for it would be absence-as-value in
reverse. The fingerprint is derived rather than hand-bumped, because a version number someone has to
remember to raise is the same defect waiting for the next key, and a parity test reds the suite the
moment `_STATS_KEYS` and `stream_stats` disagree in either direction.

`index_nights` also stops letting one night empty the listing: a night that cannot be indexed keeps its
date and names what failed, rather than taking the other eighty-nine down with it.
