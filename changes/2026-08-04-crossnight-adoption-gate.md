---
bump: patch
type: added
brief: ENGINE-VERIFICATION-FINDINGS-2026-07-18-BRIEF.md
---

`docs-ledger` gains **check3e**: `CROSSNIGHT-ENVELOPE-SPEC` §7's adoption table and
`integrator-longitudinal.js`'s header are both derived from `ls *-cross.js` rather than maintained by
hand. Corrects §7's headline — "5 of 9 nodes" counted the Integrator, which is a consumer; it is 5 of 8 —
and retires a note warning about code that had since been fixed. Mutation-verified against both real
historical drifts.
