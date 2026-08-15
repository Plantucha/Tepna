---
bump: patch
type: fixed
brief: DEV-TOOLCHAIN-2026-06-30-BRIEF.md
---

A `CLAIM` marker carrying a decimal was silently truncated. It is now rejected by name.

`readClaudeMdClaims` parsed `(\d+)`, so `CLAIM x = 5.5` yielded **5** — a fractional claim that could
then pass a check it should fail, in the gate whose entire job is stopping `CLAUDE.md` from lying about
the tree. Nothing was wrong in practice (every current CLAIM counts things and is a whole number), which
is exactly why it would have gone unnoticed.

**Tightening the pattern to refuse a decimal would have been the wrong fix.** `(?!\.\d)` stops the
truncation and replaces it with *silence*: the claim stops being parsed at all, and a claim nobody checks
is the same defect one level up. So the parser now matches the decimal and a new assertion names it:

```
✕ every CLAIM value is an integer (a decimal is REJECTED, not silently truncated)
    — malformed: clockBundles = 5.5 — a CLAIM counts things, so it is a whole number
```

Three mutants, each landing where it should:

| mutant | caught by |
|---|---|
| `CLAIM clockBundles = 5.5` — used to truncate to 5 and **pass** | the new integrality assertion |
| `CLAIM clockBundles = -5` | the same |
| `CLAIM clockBundles = 4` — a wrong *integer* | the **count** assertion, not integrality |

The third matters: the two assertions have distinct jobs and do not mask each other.

**Found by checking a peer's caution rather than assuming it did not apply.** They hit a decimal-tail bug
in a different extractor — `-0.02 over 37 paired nights` yielding `37` — and suggested checking others
for the same shape. This parser is immune to *that* one: it never scans prose for a bare number, it
requires `CLAIM <ident> = `. Probing it anyway turned up the variant that does bite. A caution that does
not apply is still worth running.
