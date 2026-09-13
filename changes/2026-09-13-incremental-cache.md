---
bump: patch
type: changed
nodes: [oxydex]
brief: SHHS-EXTERNAL-VALIDATION-2026-09-04-BRIEF.md
---

The SpO₂ cache builder is incremental and truncation-aware, so extraction can run against a corpus
that is still downloading.

The SHHS1 signal set arrives over ~15 hours. The builder previously assumed a complete directory, so
it could only be run at the end — and worse, a half-written EDF parses *fine*: `readEDF` reads the
header, believes it, and returns a night silently missing its last hours.

Three properties, each a failure it would otherwise have:

**Truncation is detected from the file's own header** — `256 + ns×256 + nDataRecords × Σsamples × 2`.
Short files are skipped, not cached, not counted as errors. No mtime heuristic: NFS granularity plus a
stalled transfer makes a partial file look settled, while the header is authoritative. Verified on the
live download — it caught 6 in-flight files on the first pass and 7 on the second.

**Already-cached records are skipped, keyed on id AND source size.** Size is what makes a re-run
correct rather than merely fast: a record cached from a truncated file is re-processed once the file
grows, instead of being trusted forever because its id was seen. Measured: second run reused 98 and
read 1, in 0.23 s.

**The cache is flushed periodically and written atomically** (temp + rename), so a long build survives
interruption and no reader sees a half-written file.

Also fixes a selftest that was asserting the wrong branch: the synthetic record was small enough that
"truncated" fell below the header size, so it exercised the refusal path while claiming to test
short-data detection. A download in flight passes through both states; both are now asserted.
