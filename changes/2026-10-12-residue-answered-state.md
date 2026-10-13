---
bump: minor
type: added
brief: RESIDUE-ABSENCE-EVIDENCE-SWEEP-2026-09-18-BRIEF.md
---

Give the residue ledger a fifth closing state, `answered <ref>`, on the owner's ruling of 2026-10-12. A row that asked for a measurement and got it can claim neither a repair nor a refutation. So it sat `OPEN`, and an `OPEN` row says the ledger still owes work. The `<ref>` names where the answer lives: the recording PR, a ledger key, or a brief. `docs-ledger` check8b fixes the shape and rejects a bare `answered`, and the new check8j resolves the pointer. Close 35 audited rows with it and with `fixed #NNNN`, state cells only.
