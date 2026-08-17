<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: none
---

`tools/rebase-safe.mjs` printed a path that does not exist: `git add verDex.html` for `OverDex.html`.

CLAUDE.md mandates this tool for every rebase, and after rebuilding it prints "AMEND them into your
commit: git add <paths>". It built that list by `.trim()`ing `git status --porcelain` and slicing three
characters off each line. An unstaged worktree modification - exactly what `rebuild()` leaves - begins
with a SPACE in the first status column, so the line is `" M OverDex.html"`. `.trim()` strips that
space from the FIRST line only, and the `.slice(3)` then ate `M`, ` ` and the path's first character.

    RAW    " M OverDex.html\n M Zebra.html"
    BEFORE ["verDex.html", "Zebra.html"]      <- first entry only
    AFTER  ["OverDex.html", "Zebra.html"]

WHY IT SURVIVED, AND WHY THE NEW CONTROLS ARE NOT PADDING. Three of the four first-entry shapes are
immune, so a fixture author picking any of them writes an assertion that passes against the BROKEN
parser:

    unstaged + UNQUOTED  " M OverDex.html"        -> CORRUPTED   (the only failing shape)
    unstaged + QUOTED    " M \"Data Unifier.html\"" -> fine, by luck
    STAGED               "M  OverDex.html"        -> fine, no leading space
    UNTRACKED            "?? OverDex.html"        -> fine, no leading space

The quoted case is the instructive one: the slice ate the OPENING QUOTE rather than a path character,
and the old trailing-quote regex removed its partner, so the two defects CANCELLED and the answer came
out right. Confirmed in the field - one session could not reproduce the bug at all, because they tested
with `Data Unifier.html`. That name is the natural pick twice over: it is this repo's canonical
multi-word bundle, it is one of the two orchestrators this tool rebuilds, and porcelain sorts by path
so `D` precedes `O`. The same tool on the same code printed a correct list on one rebase and a corrupt
one on the next, decided entirely by which artifacts happened to be dirty.

A SECOND DEFECT, found while fixing the first: porcelain paths are C-QUOTED, not quote-wrapped. git
quotes any path with a space or a non-ASCII byte and escapes the bytes, so `café.html` arrives as
`"caf\303\251.html"`. Stripping the outer quotes with a regex left the octal escapes in place and
produced a plausible-looking name that does not exist - broken in every position, not just the first.
`parsePorcelain` now un-escapes octal bytes and the C escapes (`\"` `\\` `\t` `\n` `\r` `\b` `\f` `\v`
`\a`), and takes the DESTINATION of a rename rather than returning `old -> new`, which could never be
staged.

The parse is extracted as a pure exported `parsePorcelain` and pinned by `tools · rebase-safe-porcelain`
(14 assertions), which drives it by value with no git and no filesystem. Verified RED by value: restoring
the original `.trim()` + regex-unquote kills 5 assertions - the unstaged-unquoted case and all four
C-quoting cases - while ALL THREE masking controls stay green, which is the point of including them. A
"fix" that simply quoted every path would pass the failing case and fail the controls.

Also adds `gitRaw()` beside `git()`. `git()` trims by design and every other caller wants that; a caller
parsing COLUMN-ORIENTED git output must not, because the columns encode state in leading whitespace.

Display-only in effect - `dirty` is never used beyond two `console.log`s, so nothing was ever staged
wrong. The cost was a `git add` that errors, or a verification grep run against a name missing its first
character, which is the quieter harm: it reads as "my change did not survive the rebase".

This is the second instance in one day of a tool's printed `git add` line being confidently wrong -
`tools/build-docs.mjs` names nine paths it did not touch while omitting the ones it rewrote, which
CLAUDE.md already documents. Both fail in the reassuring direction. The standing rule stands: stage from
`git status`, never from a tool's suggested command.
