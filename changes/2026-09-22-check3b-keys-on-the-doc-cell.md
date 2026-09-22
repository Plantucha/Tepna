---
bump: patch
type: fixed
brief: none
---

docs-ledger check3b keyed its row match on "the line mentions this brief", so it SKIPPED any row linking a second brief as a shared-status row — and through those 5 rows, 8 briefs' statuses were never compared at all, a skip invisible because the check can report a row that says nothing but not a brief it never reached. It now keys on the Doc cell: a cross-reference in the description no longer exempts a row, and a Doc cell that genuinely groups several docs is still exempt but COUNTED and NAMED in the assertion detail. First catch: HOSTAXIS-STABILITY's row said a bare "Brief" against a DONE header, stale since 2026-08-15 and hidden by the skip; repaired from the header. Closes residue 2026-09-06-link-substring-is-not-a-row-match, whose reported mismatch was itself the substring artifact its key names — the *(DONE)* it read belongs to the parent brief's row, which merely links the followups in prose.
