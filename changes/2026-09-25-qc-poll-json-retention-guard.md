---
bump: patch
type: added
brief: none
---

A guard, and an exoneration: **the QC poll retains no decoded JSON**, measured rather than argued.

#2999's first real night showed `json/decoder.py:361` growing by **+182,469 live objects in an hour**, and
the poll was the leading suspect — it decodes the previous `QC-SUMMARY.json` every poll and merges any
foreign keys into the new one **by reference** (`capture.py:7973`), which is exactly the shape of an
accumulator. It is not one. Over the real `summarize` + that merge + `write_verdicts`, at N = 2/3/8/16
polls, `json/decoder.py` retention is **+0 bytes and +0 objects at every N**, and the whole path retains
~**0.6 KiB per poll** — about 12 KiB/h against the observed **9.2 MiB/h**, three orders of magnitude
short. The per-poll object count *falls* as N rises (34.0 → 13.8), the signature of amortised warm-up.

All 12 `json.load`/`json.loads` sites in `capture.py` + `nightqc.py` were enumerated for where the result
is stored and who releases it: `_cpap_read_job` keeps only `last`, `_wear` is reassigned each poll,
`first_seen` holds a float per night. None outlives its poll.

The measurement ships as a **guard on a good property** — it passes today and fails the day someone
caches prior summaries — with its own **anti-vacuity control**: the same instrument is pointed at a loop
that retains on purpose and must report growth, so the zero cannot rot into a zero nobody can measure.

Residue `2026-09-25-json-retention-is-not-the-qc-poll` records the exoneration and what to measure next.
⚠️ The strongest remaining clue is the rate: **50 objects/s** is closer to a per-sample cadence (the
Verity ran at 52 Hz that night) than to ~20 polls/h, which points away from every site examined here.
Attribution needs `gc.get_referrers` on the live process or a per-subsystem probe — box work, not more
reading on the rig.
