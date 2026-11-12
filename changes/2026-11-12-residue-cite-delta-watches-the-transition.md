---
bump: minor
type: added
brief: none
---

Watch the residue ledger for the citation rot a code change causes. The new `--delta <ref>` mode judges every citation of the rows both ledgers carry, at the base ref and at HEAD. It names each citation that anchored at the base ref and stopped anchoring at HEAD. The two older scopes judge a level, so a citation that rots under a later code change sits in no population. This mode stays advisory at exit 0, because the fleet may not repair a row cell where it sits.
