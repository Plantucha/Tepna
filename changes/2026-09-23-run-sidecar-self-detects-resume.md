---
bump: patch
type: fixed
brief: none
---

`_RunSidecar` detects resume from its OWN file instead of inheriting the parent StreamWriter's flag
— it was the last writer in writers.py still inheriting after #2928. The parent's stream file and
the sidecar are two different files, and inheritance cannot see the case the self-detect idiom
exists for: the stream file non-empty while the sidecar is absent or 0 bytes, which is what a crash
before the 64 KB buffer flushed leaves behind. The inherited True then opened "a" and skipped the
header, so the sidecar never stated its own rule. Two plants, both failing on origin/main.
