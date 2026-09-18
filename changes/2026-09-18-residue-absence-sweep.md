---
bump: patch
type: fixed
brief: RESIDUE-ABSENCE-EVIDENCE-SWEEP-2026-09-18-BRIEF.md
---

Verification sweep of the residue ledger's absence-shaped rows, and a fix to the index's own
open-count instruction.

12 of 15 qualifying rows verified — 2 falsified, 10 survive. The rate is a property of the selected
subset (rows chosen BECAUSE their evidence is a non-observation) and is explicitly not extrapolated to
the other ~82 OPEN rows.

`DOCS-INDEX.md` prescribed `grep -c '| OPEN |'` for the ledger's open count. That substring matches the
ledger's own instruction line, so it reports 98 against a true 97 — and it is the command that produced
one of the three wrong counts this sweep opened with. It now prescribes the anchored row regex the
ledger's own header already carried, verified 2026-09-02 and re-verified today (97 = the gate-faithful
parser).

No residue row was edited or closed; the artifact of a wrong row is a brief section carrying the
evidence.
