---
bump: minor
type: added
---

**`QC-SUMMARY.json` is a snapshot, so a night captured before a diagnostic existed never gains it — but
the inputs are still there.** `tools/backfill_arrival.py` re-analyses an already-captured night and
reports every derived arrival field, **without writing a byte into the capture**.

The measured situation on the box, which is what makes this worth having:

| nights | arrival rows | status |
|---|---|---|
| 17, 2026-07-25 → 08-10 | **0** | permanently unmeasurable — no sidecar was ever written |
| 7, 2026-08-11 → now | 18–509 | **backfillable** — the sidecars hold everything needed |

Re-running the seven recovered lattices on all of them, including 311 streams at 30 ms on one night —
the H10 45 ms and Verity 30 ms figures in `2026-08-17-connection-lattice` came from exactly this path,
over captures that already existed.

## Non-destructive is the property under test, not a claim in this file

`arrival_quality` derives everything from the `*_PMDARRIVAL.csv` sidecars and its only `open()` is
read-mode, so re-analysis cannot damage a capture. The tool adds the one thing that could: a
destination path. So it **refuses `--json` if the destination resolves inside a night being read**,
which is the single way a backfill could turn into a migration and overwrite the summary it exists to
supplement.

A test fingerprints the whole night directory before and after and asserts it is unchanged; another
asserts the refusal both returns 2 **and** did not create the file. Verified on the real corpus too —
the sidecar set hashed identically before and after a full seven-night run.

A night with **no** sidecar reports `sidecars: 0` rather than being skipped silently. "Nothing to
measure" and "measured nothing" are different answers and only one of them is a data limitation —
which is the whole distinction between the 17 nights and the 7.

## What it does NOT do

It does not rewrite `QC-SUMMARY.json`, and deliberately so. Old summaries keep the shape they were
written with; the backfill is a report you read, not a migration you run. Nothing downstream consumes
its output, so there is no second source of truth to drift.
