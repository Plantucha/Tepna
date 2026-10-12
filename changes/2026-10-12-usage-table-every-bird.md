---
bump: minor
type: added
brief: USAGE-GUARD-2026-10-11-BRIEF.md
---

**The token table names every bird on the roster, reads the capture box's sessions, and shows the API lane on its own line.**

Owner, 2026-10-12: include Wren and Finch, and the API lane at the bottom. The usage tool takes two new
flags. The first reads a second host's transcripts over ssh. A read-only script folds them on that host,
so only one summary crosses the link.

A selftest runs that script and compares it with the local fold on the same lines. The second flag reads
the Managed Agents run logs. The last session record of each run carries its usage and its list cost.

The board reads both. It also gives every roster bird a row. A bird with no transcript in the window
reads as "not read" with the reason, never as zero. The fleet line does not include the API row,
because the plan does not bill API credits.
