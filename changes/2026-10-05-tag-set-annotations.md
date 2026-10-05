---
bump: patch
type: fixed
brief: none
---

The two public readers of a stream's session files now say in their signatures what `_placed` already accepts: a file tag, or a set of them. `stream_intervals` and `unmeasurable_files` pass the tag straight through, so their behaviour is unchanged and this is the type and the documentation catching up with the capability — but it is not cosmetic, because until a caller's signature admits a tag set, handing one over is a type error the ratcheting mypy baseline refuses. The reasoning lives on `stream_intervals`, where a caller reads it: the set is `nightqc.stream_file_tags`'s and never a second copy, because two copies of that rule is how the timeline and the night QC would come to disagree about one night.
