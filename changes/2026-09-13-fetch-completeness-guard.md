---
bump: patch
type: fixed
nodes: [suite]
brief: SHHS-EXTERNAL-VALIDATION-2026-09-04-BRIEF.md
---

`tools/nsrr-fetch.sh` skipped on existence, not completeness — so a truncated file was skipped forever.

The resume test was `[ -s file ]`: exists and non-empty. A partial EDF left by a killed worker passes
that and is then never re-fetched, silently, surfacing only when something downstream reads a night
mysteriously missing its last hours. Not hypothetical — a careless `pkill -f` stalled every worker
during this corpus fetch, which is exactly how such a file is produced.

An EDF declares its own size, so completeness is checkable with no manifest and no checksum:
`256 + ns×256 + nDataRecords × Σ(samples per record) × 2`. A present-but-incomplete file is now
removed and re-fetched, and the removal is logged rather than silent.

Verified against the live corpus: 4928 of 4928 complete, 0 short, 0 unreadable — so the guard costs
nothing on a healthy tree. Plant-verified on a real EDF truncated three ways (50 KB short, header-only,
empty): all three correctly rejected, the intact file accepted.

The same header arithmetic already guards the cache builder (`edfExpectedBytes`); this closes the
matching hole on the fetch side, where the consequence is worse — the cache merely defers a short file,
whereas the fetcher would have abandoned it permanently.
