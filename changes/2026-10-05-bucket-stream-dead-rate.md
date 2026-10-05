---
bump: patch
type: fixed
brief: none
---

`timeline.bucket_stream` no longer takes a sample rate it never used. It buckets intervals against a window, and the rate never entered the arithmetic, so every caller had to invent a value and every reader had to check whether it mattered; the signature now says what the function actually needs. The same change puts the whole function in the mutation gate's scope for the first time, and the drain that followed pinned the arithmetic underneath it: the one-bucket case, the bucket edges, the summation of several intervals inside one bucket, and both state thresholds at their exact boundaries — a dropping link writes two fragments in a bucket, and keeping only the last reported every reconnecting stream as worse than it was.
