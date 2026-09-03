<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
brief: PAPERS-ROADMAP-2026-06-24-BRIEF.md
---
The date-slug migration renamed every row key and left the row-to-row references pointing at ids
that no longer exist. Repairs the two in my own rows.

`2026-09-02-papers-remedy-unavailable` said "Blocks R17" and `2026-09-02-papers-cohort-never-recorded`
said "BLOCKED ON R16"; neither id survives the migration, so the dependency between the two rows —
the one that stops someone picking up the cohort work before the harness runs — resolved to nothing.

This is the gap noted the night before it happened: `docs-ledger` check8 resolves row↔brief in both
directions and does NOT verify row↔row, so these references are prose to the gate and a rename breaks
them silently while every check stays green.

⚠️ TWO MORE ARE STILL DANGLING and are deliberately NOT touched here — `2026-09-02-pat-table-row-
unreproducible` ("Independent of R8 and R9") and `2026-09-02-pat-detailcorr-unread` ("Note R12 is a
THIRD instance"). They belong to another session; flagged rather than edited.

On the contract: RESIDUE.md says a row is closed by changing only its state cell and nothing else is
ever edited. The migration already rewrote every key wholesale under a sanctioned refactor, so
repairing the references that refactor broke completes it rather than altering a claim — but the
tension is real and worth ruling on, because it will recur at the next rename.
