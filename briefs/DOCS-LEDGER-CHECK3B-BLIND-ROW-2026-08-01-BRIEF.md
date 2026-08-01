<!--
  DOCS-LEDGER-CHECK3B-BLIND-ROW-2026-08-01-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-08-01 · **Found-by:** `MOTIONDEX-BUILD-FOLLOWUPS-2026-07-18-BRIEF.md` (while closing it)

# `docs-ledger` check3b reports "in sync" for a DOCS-INDEX row that carries no status at all

## 1 · The hole

`tests/dex-tests.js`, check3b — the gate that keeps each DOCS-INDEX row's status equal to its brief's
header status:

```js
var m = last.match(/\*\(\s*(DONE|PROPOSED|IN-PROGRESS)\b/);
if (!m) return; // no brief-status marker in the role cell → nothing to compare
```

A row with **no** status marker is silently skipped, and the group then reports **`in sync`**. The check
can see a *wrong* status; it cannot see a *missing* one.

**Demonstrated, not reasoned:** deleting the ` | Brief *(DONE 2026-08-01)* |` cell from a real row leaves
check3b green with the message `in sync`. That is how it was found — a shell-quoting slip ate the cell
during an edit, every gate stayed green, and only reading the diff caught it.

This is the same failure class the `DEEP-SCOUT-HOLLOW-GATES` wave spent 21 gates removing, sitting inside
the docs gate itself: an assertion that looks authoritative and answers a question it never asked.

## 2 · Why it is not a one-line fix — measured first

Changing `if (!m) return;` into a failure would red **48 of the 249** currently-compared rows:

```
rows compared:                201
rows with NO status marker:    48
```

(examples: `AUDIT-FOLLOWUPS-II-BRIEF.md`, `CPAPDEX-BUILD-BRIEF.md`, `DEEP-AUDIT-2026-07-11-BRIEF.md`,
`CONTROLLED-RELEASES-2026-07-05-BRIEF.md`.)

So this is a **48-row cleanup**, not a drive-by. Two things make the timing awkward and are worth saying
out loud rather than discovering mid-PR:

- **Every PR touches `DOCS-INDEX.md`.** Six merged in one recent night, all of them editing it. A 48-row
  edit will conflict repeatedly; it wants a quiet window, or splitting by section.
- **A grandfather list is the wrong shape here.** `CPAP-REAL-CORPUS-FOLLOWUPS-II` §4 deliberately retired
  the committed `docs-ledger-list.txt` snapshot to kill a per-PR merge tax; re-introducing a 48-entry
  exemption list would rebuild exactly that, and at a size where the exemption *is* most of the problem.

## 3 · Options

1. **Backfill all 48 rows, then tighten the check.** Correct and permanent. Each row needs its brief's
   real header status read, not guessed — the header is the source of truth by this gate's own rule.
2. **Tighten for briefs created after a cutoff date**, mirroring the §📌 grandfathering already used for
   pre-2026-07-03 headerless briefs. Cheap, bounded, and stops the bleeding immediately; leaves the 48.
3. **Tighten only for `DONE`.** A stale `PROPOSED` on a finished brief is the costly direction (it hides
   completed work); a missing marker on an old brief is mostly cosmetic. Narrower than (2) but targets the
   case that actually misleads.
4. Leave it. Rejected: the check currently *claims* "in sync" about rows it never looked at, which is
   worse than not having the check, because it is quoted as evidence.

**Recommended: (2), then (1) opportunistically** — a dated cutoff is one line, cannot conflict, and each
old row can be backfilled by whichever work-unit next edits that row anyway.

## 4 · Done when

- [ ] check3b fails on a row that carries no status marker, under whichever scope §3 selects.
- [ ] **Mutation-verified in both directions**: deleting a status cell reds it, and restoring it greens —
      the check being fixed is precisely one that passed when it should have failed, so a fix asserted
      without that proof would repeat the original error.
- [ ] The scope decision and the 48-row count are recorded here, so a later reader knows the gate is
      deliberately partial rather than accidentally so.
- [ ] If (1) is taken, each backfilled status is read from the brief header, never inferred from the row.

## 5 · Note

`check3` (every brief appears in DOCS-INDEX) and `check3b` (statuses agree) are complementary, and only
`check3` is total. A brief can be indexed by a row that says nothing about it and satisfy both.
