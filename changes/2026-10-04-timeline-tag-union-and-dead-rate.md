---
bump: patch
type: fixed
brief: none
---

The night timeline finds the ring's accelerometer again, and stops asking for a rate it never used. A configured stream can legitimately be written under more than one file tag — `acc` arrives as `_ACC.` from the chest strap and `_ACCRAW.` from the ring — and the timeline compared the file tag against the stream name upper-cased, so a 10 MB `_ACCRAW.txt` matched nothing and that device's whole night was painted idle, which reads as a finding rather than a miss. The tag set now comes from `nightqc.stream_file_tags`, which already owned that mapping and its reasoning, rather than a second copy that could drift from it; a bare string is still accepted, so every existing caller is unchanged. Separately, `bucket_stream` no longer takes a sample rate: it buckets intervals against a window and the rate never entered the arithmetic, so every caller was inventing a value and every reader had to check whether it mattered.
