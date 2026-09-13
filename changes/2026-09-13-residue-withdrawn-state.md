---
bump: patch
type: added
nodes: [suite]
brief: none
---

The residue ledger gains a fourth closing state, `withdrawn <key>` — owner ruling 2026-09-13.

The other three all assert that something HAPPENED: a fix, or a promotion to a brief. A row whose
defect turned out not to exist can claim none of them, and closing it `fixed #NNNN` would assert a
repair that never occurred and cite a PR that did not make one — the fabricated-close analogue of the
fabricated evidence tier §🎫 forbids.

Measured before asking: 8 such pairs, 16 rows, **25 % of the OPEN queue**, and growing by two every
time the ledger corrects itself. The queue was expanding with the ledger's own accuracy.

GATE-ENFORCED, which is the half that makes it safe. `docs-ledger` check8i requires the named key to
EXIST and that row to state the withdrawal itself — it must name the withdrawn row back, in terms. So
retiring a row costs two rows and the second is a standing public claim, which is the friction a false
withdrawal should meet and an honest one should not. Without it, a genuine defect could be closed by
asserting it is not one, which is strictly worse than a queue that over-counts.

Plant-verified in both failure modes: a withdrawal naming a row that does not exist, and one the named
row never mentions, each red check8i. Four self-tests pin the check itself, including a row that tries
to withdraw itself.

Applied conservatively to two rows only — the ones whose defect is stated as a FALSE POSITIVE.
`REFINES` and `NARROWS` are not withdrawals: those defects are real and merely better described.
