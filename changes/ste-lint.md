---
bump: minor
type: added
brief: none
---

**The writing rules, checked — and an approved-word layer that is ours.**

`tools/ste-lint.mjs` reports, with line numbers: a long sentence (20 words in a procedure, 25
elsewhere), passive voice, a verb-noun in `-ing`, two imperatives in one sentence, a retired term, and
a paragraph over six sentences. `docs/GLOSSARY.md` holds the approved terms.

The rules come from **ASD-STE100, Issue 8 (2021)**. **ASD copyrights its dictionary and neither file
copies any of it.** Every approved term comes from this repository and names the form it already uses
most, by count: `re-bundle` 1378 against `rebundle` 4, `fixture` 2407 against `golden` 517.

Advisory by owner ruling. The verdict is `NOT_APPLICABLE` with the count beside it — never `PASS` over
findings, never `FAIL` on a backlog nobody was asked to clear. `--strict` exits 1 and is for later. No
hook and no CI wiring here.

Measured: **CLAUDE.md 32 · ORIENTATION.md 5 · docs/GLOSSARY.md 0.**

The tool found four defects in itself and one in its own glossary while I ran it on this repository:
its glossary parser read the table's own header row as a retired term, a run of numbered rules counted
as one seventeen-sentence paragraph, `the writing rules` read as a verb-noun, and `empty` was retired
too broadly — that last one produced four findings against correct English, so the entry now retires
`missing` alone and says why.
