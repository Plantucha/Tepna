<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: []
brief: DOCS-LEDGER-CHECK3B-BLIND-ROW-2026-08-01-BRIEF.md
---
Two stale claims corrected in place, and the two gate limits that let them survive recorded.

**1 · `ENGINE-VERIFICATION-FINDINGS`'s DOCS-INDEX row said "§1.2 … still owed". It was not.** Verified in the code rather than in either header: `dex-ingest.js` `deviceKey` matches `(?:\d{8}_\d{6}|\d{14})` and `stampMs` carries an optional separator (`_?`), so both the PSL `…_YYYYMMDD_HHMMSS_` and the contiguous capture-host `…_YYYYMMDDHHMMSS_` shapes resolve — the widening landed in PR #221, exactly as the brief header said. The row contradicted its own brief for weeks. **PR #670 edited that row and carried the false clause forward verbatim**, because the edit appended to the cell without re-reading the sentence beside it.

**2 · `DEEP-STAGE-DESAT-CONFOUND` was `PROPOSED` with five of six Done-when boxes checked** and five executed sections in its body (§3b, §7, §8, §9, §11). The sixth — *a better LABEL* — is explicitly not a code change and needs a reference the corpus does not contain, so it cannot be DONE; but a brief with five executed sections is not PROPOSED. Corrected to IN-PROGRESS in both the header and the row.

**Why the gates were green through both.** `check3b` enforces **row ≡ header**, so it is blind to a status wrong in *both* places — consistent, and consistently false, which is exactly case 2. And it compares the status **cell**, never the row's **prose**, which is case 1. Both are now recorded in `DOCS-LEDGER-CHECK3B-BLIND-ROW` §4b alongside check3c's own scope note.

Deliberately **not** gated. A prose-vs-body checker needs judgement — the objection §4a already used to rule that out for check3c, and check3c's string-matcher limit (it cannot tell a quoted historical claim from a live one) is the same wall. What is cheap is the habit, and that is what §4b records: read the whole cell when you edit a row, and check the boxes when you flip a status instead of inheriting the line above.

Mutation-verified that check3b does catch what it claims: reverting the row cell to `PROPOSED` while the header reads `IN-PROGRESS` reds it (`index PROPOSED ≠ header IN-PROGRESS`); restoring greens it.

Docs only — no shipped source, no `manifestHash` movement, no fixture re-recorded.
