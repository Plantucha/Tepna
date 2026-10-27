# Magpie — unit `bandpend`

**Row:** `2026-10-27-the-streak-counts-a-night-whose-verdict-predates-its-own-band` (new, closed in the same diff)
**Branch:** `claude/bandpend-mg` · **Worktree:** `wt-bandpend-mg` (sibling of the primary checkout) · **Base:** `6567f8b20`
**Rule 0:** `board solid nights streak in-progress night skipped by folder date` →
`tools/board.mjs:1012-1044`, `handoffs/magpie-boardstale.md:1-40`, `briefs/RESIDUE.md` row
`2026-10-25-a-refused-night-shaped-directory-reads-as-a-flat-root`.

## The defect

`solidNights()` walked the nights backwards and broke on the first night that was not PASS. It skipped
one night alone: the night whose folder date equalled today in UTC. A night's band runs from 18:00Z to
10:00Z the next morning, so the night in progress right now carries YESTERDAY's folder date for sixteen
hours of every day. The loop therefore met an unfinished night, read it as a finished failure and
stopped.

## Both signs of the defect, measured ten minutes apart

| read at | 10-26 on the box | old rule | what it did |
|---|---|---|---|
| 09:06Z | UNKNOWN, 6 files | streak **0** | broke on an unfinished night while 10-25 was PASS |
| 09:07:13Z | PASS, 45 files, band to 10-27T10:00Z | streak **2** | counted a night still recording |

The order reported the first sign. The box re-judged every verdict between 01:38Z and 09:11Z today, so
by the time I read it the same rule showed the other sign. One rule, two wrong answers, and the second
one flatters the fleet.

## The rule now

`streakOf(rows, nowMs)` exports as a pure function. A night counts only when its verdict time falls at or
after the end of its own band, read from `result.scope.band[1]`. A night judged before its band ended
goes to `pending`, where it neither extends nor resets the streak. The clock splits pending in two:
`in-progress` while the band still runs, `stale-verdict` once it has ended with no re-judge. The second
kind names a box-side omission rather than an unfinished night.

## ∅ · what an absent band does

🔴 **A band-less night STOPS the streak rather than skipping it.** Skipping it would join two nights
across a night nobody measured, and publish them as adjacent. A PASS with no band and a PASS with no
verdict time each stop for their own named reason.

I measured the cost of that choice before taking it. Of the 59 verdicts on the box, 21 carry no
`result.scope.band`, and every one of those 21 reads UNKNOWN or NOT_APPLICABLE. Not one is a PASS. So
the strict branch costs nothing over today's corpus, and it stays right when the box starts writing
bands on nights it passed.

## Live comparison, over the real box

- OLD → `streak 2`.
- NEW → `streak 1`, pending `2026-10-26 in-progress` and `2026-10-27 in-progress`, stopped by
  `2026-10-24 is UNKNOWN`.

## Gates

- `node tools/board.mjs --selftest` ✓ **91**, up from 77. Fourteen new legs, four of them controls.
- Three plants, each named below.
- `npx --no-install biome check tools/board.mjs` ✓
- `npm run check` — appended below.

### The plants

| plant | reds |
|---|---|
| A · no pending branch at all (`if (false && atMs < endMs)`) | 7 legs |
| B · the absent-band branch skips instead of stopping | 2 legs |
| C · the pending kind ignores the clock | 2 legs |

🔴 **PLANTS A AND B FIRST CRASHED THE HARNESS INSTEAD OF REDDING BY NAME.** My legs read
`v.pending[0].date` and `nb.stoppedBy.reason` without a guard. Under a plant those reads throw, the
selftest runner dies on a stack trace, and the run prints no `N FAILED of 91` line at all. A leg that
throws names nothing, and it also hides every leg after it. Optional chaining on each read fixed all
three plants, and the counts above are what they report now.
