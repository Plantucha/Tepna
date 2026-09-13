---
bump: patch
type: fixed
nodes: [docs]
brief: DOCS-LEDGER-HEADER-REFS-2026-08-27-BRIEF.md
---

A DOCS-INDEX row states its status twice, and only one of them was checked.

`check3b` compares the trailing `*(DONE …)*` marker against the brief header. The description cell's
opening bold word — `**DONE — 2026-08-15 (executed as #1227) — hostAxis publishes …**` — is the other
statement, and it is the more prominent one: first in the row, bold, and the thing a reader scanning
"what is open?" actually reads.

Measured at `dfb29983`: **15 rows whose trailing marker AGREED with the header while the opening
disagreed**, so `check3b` was green and correct throughout. Eleven DONE briefs were announced as
PROPOSED at the head of their own row — including `DOCS-LEDGER-HEADER-REFS` itself, whose entire
subject is a header status fact that nothing resolves. Same hole as the brief that built `check7`,
one cell over.

All 15 corrected, and `check3c` now gates the opening so it cannot drift again. It reds on the
pre-fix index naming every offender and the one-word fix; green after.

⚠️ SCOPE: the executable statuses only (DONE | PROPOSED | IN-PROGRESS), matching `check3b`'s. A row
opening `**REFERENCE — the standing PAT verdict …**` labels what the DOCUMENT IS rather than claiming
a lifecycle state, and both such rows sit on briefs that are DONE and superseded; widening the rule to
all five status words would rewrite a role label into a status — an invariant convicting deliberate
practice. The boundary is pinned by a self-test rather than described, which is the discipline the
parent brief's §5 applied to `check7`.

The brief's own `## Done when` boxes are also ticked, re-verified item-by-item against the tree rather
than read off its §4a execution note: each assertion was located by name AND observed to run green —
different claims — with `check7` scanning 537 header refs across 508 briefs in that run.
