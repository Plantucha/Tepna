# Magpie — unit `stampread`

**Row:** `2026-10-27-the-stamp-census-population-erases-the-repair-it-certifies` (OPEN at the ref)
**Branch:** `claude/stampread-mg` · **Worktree:** `wt-stampread-mg` (sibling of the primary checkout) · **Base:** `9d346e5c5`
**Rule 0:** `a census population keyed on a spelling drops the file the repair fixed` →
`ext:memory/a-rule-keyed-on-a-module-name-cannot-see-a-split.md:28-43` (the parent position),
`ext:memory/a-text-census-counts-the-text-explaining-it.md:1-17`,
`tools/corpus-census.mjs` chunk 4/8 (which key a census counts by).

## What changed

`tools/stamp-consumer-census.mjs` admitted a file when its text spelled a 14-digit run. It now admits
a file when the comment-blanked source spells that run **or** calls one of seven stamp owners by name,
and the verdict says which route admitted each file.

| | before | after |
|---|---|---|
| declared files | 28 | 37 |
| time readers | 14 | 26 |
| anchored | 14 of 14 | 25 of 26 |
| owner call sites | — | 50 |
| admitted by the spelling alone · owner call alone · both | — | 13 · 6 · 18 |

## The three findings, in the order the instrument gave them

🔴 **EVERY FIGURE THE ROW PREDICTED WAS SHORT, BECAUSE THE ROW DERIVED IT FROM THE PREDICATE UNDER
REPAIR.** The row named 13 delegators over two owner spellings and four files outside the census; the
full vocabulary gives 30 delegators and eight outside. It predicted the time readers would rise from
14 to 18, and they rose to 26. A prediction keyed on the rule it corrects inherits that rule's blind
spot, so it reads as a floor.

🔴 **THE READING WAS KEYED ON THE SPELLING SITE, NOT ON THE FILE.** Five declarations describe the
regex rather than the behaviour. `oxydex-dsp.js` read `docstring` while converting a filename stamp to
an instant at two sites; `adapters/resmed-edf.js` and `pat-classic-vs-fused.js` each read
`accept-test` while returning one. All five carry a re-read note and the readings they earn.

🔴 **A THIRD READER ANSWERED TO NEITHER PREDICATE, AND THE SEPARATOR RULE IS WHY.** Three files spell
the stamp `[_-]?` between the atoms, and a character class ended a run. The owner predicate reaches
two of them. `cpapdex-dsp.js:85` holds the Clock Contract's 14-digit arm in a node-local
`parseTimestamp`, CPAPDex carries no `clock.js`, and so no owner call exists to find. The separator
rule widened by the class CONTENTS in the same diff: a class of `_` and `-` joins a run, one holding
`T` or a space ends it. Over the tree that admits exactly one file and drops none.

## Six plants, each red by name, none of them throwing

| plant | reds |
|---|---|
| the owner predicate returns nothing | 13, including every live-tree leg |
| the definition guard removed | 3 |
| the scan reads raw text rather than comment-blanked source | 2 |
| the separator widening reverted | 6 |
| the separator class admits any contents | 3 fixture controls |
| any short gap counts as a separator | 8, the live ISO control among them |

⚠️ **THE CLASS-CONTENTS CONTROL IS PROVEN ON FIXTURES, AND THAT IS A STATEMENT AND NOT A HEDGE.**
Every ISO run in the tree also carries a bare `-` or `:` gap, so a plant admitting any class contents
changes no live membership. The live control catches the wider failure instead: dropping the
separator rule altogether pulls `verdict.js` and `tools/aperiodic-offset.mjs` in.

## What the instrument learned about itself

🔴 **MY OWN SELFTEST FIXTURES MADE THE FILE AN OWNER CALLER.** Before these legs the census matched no
owner call in its own source, because `STAMP_OWNERS` spells the names with `\s*\.` and never the
literal call. The fixtures then wrote `DexClock.fileStamp(` as literal text, and a text census reads a
string exactly as it reads a call. Both routes now admit the file, some of its owner sites are test
data, and the declaration a reader meets says so.

## Gates

- `node tools/stamp-consumer-census.mjs --selftest` ✓ 74
- `node tools/stamp-consumer-census.mjs` ✓ PASS, 0 entries, 0 departures
- `npm run typecheck` ✓ 0 · `npm run lint` ✓ 0 over 470 files · `npm run verify:tools-index` ✓
- `npm run check` — result appended below

## Not in this PR

`briefs/RESIDUE.md` gains `2026-10-27-the-cpapdex-14-digit-stamp-arm-bounds-no-run`: that arm matches
inside a longer digit token and `_ckMk` is the only guard. Repairing it re-bundles CPAPDex, so it owes
a unit of its own.
