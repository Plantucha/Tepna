---
bump: patch
type: fixed
brief: RESIDUE 2026-09-23-check8h-reads-a-changeset-filename-as-a-row-key
---

`docs-ledger` check8h treated any `YYYY-MM-DD-slug` in a row body as a cross-reference to another
residue row, so a row citing its changeset by filename reds as a dangling reference — and the message
named the changeset, which reads as "your pointer is broken" when the truth is "your row quotes a
file". A row key and a changeset filename are the same shape by construction: §📌 mandates date-plus-slug
for both, for the same anti-collision reason.

It is not merely noisy. `changes/` is pruned at every release, so a citation that resolves today is
guaranteed to dangle after the next one — there is no state in which flagging it is right.

The discriminator is structural, matching the existing `R\d+\b(?!-)` fix beside it: a row reference
appears bare, a file citation carries `changes/` or `.md`. Flagged references now also say they were
seen bare, so a dangling row pointer is distinguishable from a quoted filename in the message itself.
