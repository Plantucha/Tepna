# Unit `boarddoc` — the board's closure reader stops reading its own documentation

**Status:** IN PROGRESS · **Session:** Magpie · **Date:** 2026-10-31

- **Row:** `2026-10-28-the-board-closure-reader-matches-its-own-documentation`, source `tools/board.mjs`
- **Branch:** `claude/boarddoc-mg` · **Worktree:** `wt-boarddoc-mg` · cut from `1b6dd7f38`
- **Board:** claim #2582

## Rule 0

`board renderer closure reader derives file names from its own comment and selftest unresolvable` →
`ext:memory/a-hand-typed-closure-stops-at-the-line-break.md` 0.032, `tools/board.mjs:2044-2140` 0.032,
`ext:memory/INDEX-instruments-and-inference.md` 0.031. The top hit is my own unit `boardclos` (#4038),
which built this reader.

## The mechanism, measured at `1b6dd7f38`

The reader derives its population from raw text, so documentation joined it. Of the six shell-pattern
matches, three execute and three sit in ONE block comment, which derived `tools/x.mjs`. All three
mid-line relative imports are the selftest plant, and one derived `tools/inner-helper.mjs`.

## The fix

- `executableText` blanks block comments and statement-position line comments. It blanks rather than
  deletes, so every line number and `^` anchor still lands.
- An import counts as an edge only at statement position. A plant string spells an import when
  `readText` hands it over as a file, and carries data when it sits inside another file.
- A mid-line `//` example still derives a name, deliberately. Stripping one means telling a comment
  from a `//` inside a string, and this file carries URLs in strings.

## Evidence

- Side-by-side crawl over this tree: **8 real files before and after**, 2 unresolvable names before,
  **0 after**. The crawl lost no real file and derived no new one.
- `node tools/board.mjs --selftest` reads all 155 passed, up 9 legs.
- Mutation controls: an identity `executableText` reds 5 legs, and an unanchored import rule reds 2.
  Each half of the fix carries its own red.
- `npm run typecheck` and `biome check tools/board.mjs` both clean.

## Next step

Push, open the draft PR, close the row inside it with that PR number, then run the full gate on the
final state. I never undraft my own PR.

Fleet-Session: Magpie
