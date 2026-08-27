---
bump: minor
type: added
brief: DOCS-LEDGER-HEADER-REFS-2026-08-27-BRIEF.md
---

`docs-ledger` **check7** — a backticked `*-BRIEF.md` on a brief's `**Status:**` line must resolve to a
real brief.

check4b already resolves relative *links* in `DOCS-INDEX.md`; a brief's own header names its neighbours
in **backticks**, and nothing resolved those. A header could cite a brief that was never merged, was
renamed, or never existed, and every gate stayed green — the reference was prose to every checker here.

**Demonstrated, not argued:** a dangling ref planted in a real brief header ran the group **38/38
green**; with check7 the same plant **reds**, naming file and ref.

⚠️ **The brief's own scope reasoning is corrected in the same change.** It argued the Status line is
safe *because prose lives below the header* — measured, prose lives **on** it (one status line narrates
four briefs). Re-measuring at the brief's own revision gives **526** refs, not the 267 its table states;
the single dangling ref is the one it predicted, so the semantics matched and only the count did not.

**Scope fails CLOSED by design.** Keyed-only matching (`**Executes:** …`) would cover 338 refs and go
blind on the next relation verb — **51 distinct keys** are already in use, from `Follows` (128) down to
one-offs like `Supersedes-section-of`. Matching every backticked brief name on the line covers a new
verb the day it is coined. The width's cost is measured, not assumed: 538 refs across 476 briefs,
**0 dangling**.

Four self-tests: the plant fires; a real ref resolves (so the plant is not firing on everything); prose
below the header is ignored; an unbackticked name is ignored (links are check4b's). The last two pin
§5's boundary so a later widening to the header block cannot re-admit the template-name class.

🔴 Zero real defects on current `main`, stated rather than hidden — the value is prospective, the same
argument that justified `commit-shape` and `stale-file`.
