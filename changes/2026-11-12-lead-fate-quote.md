---
bump: patch
type: added
brief: none
---

Quote the naming commit's own fate sentence beside each lead row in `node tools/residue-ids.mjs --open`. The tool already counted 19 of the 28 OPEN rows that a later code commit names. It then told a picker to read those PRs. A hand read of the 18 leads on 2026-11-12 found every one of them stating the row's fate in the naming commit's body. That read closed no row, at a cost of about ten turns of PR reads.

The new `leadFate` reports a `stated` quote when the paragraph names the key. It reports a `SOLE-KEY` quote when the message names exactly one row, and an `UNATTRIBUTABLE` quote when it names several. That mark mirrors the attribution the citation read already draws.

The verb set is a floor on those statements. So the regex reaches 15 of the 19 leads, and a row with no quote is one the regex could not read. The quote is a lead and never a proof, because only the state cell closes a row.
