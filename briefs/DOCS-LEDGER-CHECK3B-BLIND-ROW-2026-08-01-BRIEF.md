<!--
  DOCS-LEDGER-CHECK3B-BLIND-ROW-2026-08-01-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-01 · **Created:** 2026-08-01 · **Found-by:** `MOTIONDEX-BUILD-FOLLOWUPS-2026-07-18-BRIEF.md` (while closing it)

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

## 6 · Executed 2026-08-01 — option (1), and there was a second hole

### Option (1), not the recommended (2)

§3 recommended a dated cutoff because a 48-row edit "wants a quiet window". The window existed — **one**
open PR at the time — and the backfill turns out to be mechanical: every status is *read from the brief
header* by script, which is what §4's last item requires and is strictly more reliable than a human
transcribing 36 of them. A cutoff would also have left the gate permanently partial for no lasting reason.

### The 48 were not all the same thing

Re-measuring before touching anything (rather than inheriting the count) split them:

```
single-brief rows examined  : 255
  carrying a status marker  : 207
  NO marker (blind)         :  48   ← §2's number, confirmed
    …genuinely status-less  :  36
    …stating a status the regex could not see : 12
  actual mismatches         :   0
```

The second group is a **distinct defect the brief did not identify**. The marker regex was
`\*\(\s*(DONE|…)`, so it missed every row that stated its status slightly differently:

```
Brief *(**DONE 2026-07-14**)*        bold inside the parens
Brief *(✅ DONE 2026-07-05 …)*        emoji first
Brief (**DONE 2026-06-30** …)        plain paren, not *(
Brief (§3 DONE 2026-06-30 · …)       qualifier first
```

Those twelve rows **had data to compare and were never compared**. Recovering them surfaced **zero** new
mismatches — the index was honest — but the gate could not have known that, which is exactly the
objection §1 raises. A checker blind to correct-but-differently-spelled data is the same class of hollow
as one blind to absent data; it just fails to notice agreement instead of failing to notice silence.

### What changed

1. **Matcher loosened** to tolerate `**`, a leading emoji/tick/qualifier, and a bare `(`. +12 rows now
   compared.
2. **36 rows backfilled** by script from their brief headers, date included where the header carries one.
3. **A missing marker is now a failure** — a second assertion, deliberately separate from the equality
   one, so the failure message says which of the two things went wrong.

### Mutation-verified in both directions (§4's second item)

```
delete a status cell  → ✕ "…every such row STATES a status"   (and the equality check still says "in sync"
                          — which is precisely the original bug, visible in the same run)
wrong status in cell  → ✕ "row status ≡ brief header status"  (and the presence check stays green)
```

Each assertion catches its own failure and neither covers for the other. The equality check reporting
"in sync" next to a red presence check is the clearest possible statement of what was wrong before.

### Scope, recorded per §4's third item

The gate is now **total over single-brief rows with an executable header status** — 219 of them, no
exemptions, no cutoff date, no grandfather list. It remains deliberately partial in exactly two places,
both unchanged and both structural rather than accidental: **multi-brief rows** (one shared status cell —
nothing unambiguous to compare) and **non-executable statuses** (`REFERENCE`/`CHECKPOINT`, which §📌 does
not date-stamp). §5's observation stands: `check3` is total, `check3b` is total over that scope.

## 4a · A SIBLING BLIND SPOT, found the same day by walking into it

check3b compares a brief's **DOCS-INDEX row** against its **header**. Neither it nor any other gate looks
*inside* a brief for self-contradiction — and that is a live failure mode, not a hypothetical:

- `ENGINE-VERIFICATION-FINDINGS` carried a header saying §1.2 was "still owed" while §1.2 had landed. Its
  own header records that this "nearly redid" one session's work.
- The fix went into the header and **left §2's Phases block saying the same false thing**, which sent a
  second session (2026-08-01) on the same errand before it was reconciled.
- Then closing §1.7 updated §1.7's body and §2 — and **left the header still listing §1.7 as "not
  re-verified closed"**. Third instance, same brief, same day, by the session that had just fixed the
  second one.

All three are the same shape as the missing-status-cell hole above: **a claim with nothing watching it.**
The row/header pair is gated; header-vs-body is not.

A narrow, mechanical check is available and worth considering with §3's options: *within one brief, a
section number must not appear in both a "CLOSED"/"DONE" claim and a "Still open:" list.* That is
string-matching, not judgement, and it has an obvious failure mode to avoid — a brief legitimately saying
"§1.6 half closed, half still open". So it would need the half/partial vocabulary excluded, or to be
scoped to exact "Still open: …§N" enumerations only. **Not built here** — a gate that cries wolf on the
legitimate partial case would be turned off, which is worse than the hole.

## 5 · Note

`check3` (every brief appears in DOCS-INDEX) and `check3b` (statuses agree) are complementary, and only
`check3` is total. A brief can be indexed by a row that says nothing about it and satisfy both.
