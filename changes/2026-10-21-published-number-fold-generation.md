---
bump: minor
type: added
brief: none
---

Record which corpus FOLD a published number was cut from, and re-resolve it afterwards.
`tools/fold-generation.mjs` reports two separate identifiers over `uploads/trio`: a data digest over
the export files, and a fold generation over the night set and each night's `.trio-stamp` code
digest. The two stay apart because the digest the live records carry covers the stamps as well, so
writing provenance invalidates the number. `tools/tch-pooled-hat.mjs` now emits that block, scoped
to the nights it read. A suite group re-resolves every live record and names each excluded one.
