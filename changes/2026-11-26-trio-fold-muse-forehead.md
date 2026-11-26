---
bump: minor
type: added
brief: none
---

The trio fold (`tools/trio-batch.mjs`) now writes a `PpgDexForehead` export from the Muse S optics, through the one decoder `PATAlign.decodeMuseOptics` and the forehead constants in `PATAlign.FOREHEAD`.
The fold realm now loads `sq-table.js`. Without it, every ECGDex and PpgDex leg threw since #5711.
`tools/tch-multinight.mjs` reads the corner from the file-name prefix first, so a finger or forehead site export is no longer read as the wrist corner.

Each `.trio-stamp` now binds the sha256 of every export that the fold wrote for that night. A fold now removes every old output of a night before it recomputes that night. Before this, a leg that refused under new code left its old export behind, and the fold summary counted it as landed. The split path writes no stamp when a trio leg export predates the fold.

The new gate `verify:trio-cache` (`tools/trio-cache-audit.mjs`, verdict `trio-cache-integrity`) audits every stamped night. It fails on a moved byte, an absent export, an unbound export or a stamp that binds no bytes. It also prints a population verdict over the night folders it walked.

This change does not re-fold the corpus. It seals the 90 existing stamps in `uploads/trio` to the bytes that each stamp's own commit wrote. The seal script checked that no export moved after its stamp commit, and it refused 0 of 90. The pooled table in the paper brief keeps every number, and only its `inputsDigest` moves.

The three new compute modules move `CODE_DIGEST`, so every sealed stamp now reads as folded under older code. The corpus now owes a re-fold, and a follow-up PR carries it with the paper re-cut.

`tools/fold-provenance.mjs` now drops the host from a network mount source before it writes the fold ledger. The corpus moved to an NFS mount, and the ledger would otherwise commit a LAN address.
