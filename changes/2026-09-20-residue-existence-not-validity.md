---
bump: patch
type: fixed
brief: none
---

**`docs-ledger` check8h/check8i named the wrong object when a residue row was malformed.**
`residueRows()` pushes a row that fails validation to `malformed` and returns, so it never
reaches `out.rows` — and both reference checks resolved keys against `out.rows` alone. A
reference to a malformed row therefore reported **"no such row"** for a row sitting visibly in
the ledger, sending a reader to look for something that is not missing.

Observed 2026-09-20 on a real edit: one row whose state read `withdrawn by measurement` (outside
the vocabulary) produced three findings, of which **check8b was right and the other two pointed
at the wrong artifact**. A secondary error that names the wrong object is worse than a primary
one that names nothing, because it is actionable in the wrong direction.

Existence and validity are now separate questions. `residueRows` records every well-formed key it
sees, valid or not, before either malformed exit; `check8h`/`check8i` ask only whether the row
exists, while `check8b` still reports the malformation precisely and `check8i` still requires the
named row to state the withdrawal in its own defect cell. Five self-test assertions plant exactly
that ledger — one malformed row, one valid row referencing it — and a genuinely absent key is
still absent, so the checks keep their teeth.

Fleet-Session: Magpie
