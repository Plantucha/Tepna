---
bump: patch
type: fixed
brief: none
---

`tools/residue-ids.mjs` reported **`ok — 0 row(s) added, none colliding, none mutated`** against a
ledger carrying the same key twice — once `OPEN`, once `fixed #2498` — contradicting itself about
whether a defect is live. Measured by Osprey on #2503 and filed as #2506.

**The blindness is structural, not an oversight.** `briefs/RESIDUE.md` carries `merge=union`, and a
union driver cannot represent an **edit** — it keeps both sides' lines. Closing a row *is* an edit (the
contract closes a row by changing only its state cell), so a rebase over a concurrently-closed row
yields two rows with one key. This tool could not see it because `added` is empty when both copies
already exist on the base, and the only uniqueness assertion ran over `added` alone. The
`Map(head.map(...))` lookups compound it: a Map silently keeps the last of a duplicated key, so every
by-id comparison sees one row where the file has two.

The check now runs **first and independently of base/added** — a straight scan of the head file for a
repeated id. Verified in both directions: the planted union-merge shape fires, a plain close stays
silent, and the real 156-row ledger reports clean, so it is not noise. Mutation-verified rather than
assumed — replacing the condition with `if (false)` reds the new selftest, restoring it greens.

⚠️ **Scope: this DETECTS the duplicate and decides nothing about `merge=union`.** Dropping that
attribute would restore the per-PR conflicts it was added to kill one day earlier; the real options
(union plus hand-repair on close, a custom driver that appends but refuses to duplicate a key, or
closing rows only in a PR that cannot race) are the ledger's concurrency story and belong to #2506.

`docs-ledger` check8c already catches this at gate time, so it could never *land* unnoticed. What was
wrong is that the pre-push tool whose name most suggests it would catch it passed the author through —
a checker blind exactly where a merge puts the damage is the failure class it exists to prevent.
