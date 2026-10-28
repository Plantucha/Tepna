# Magpie — unit `ffblock`

**Row:** `2026-10-27-the-board-renders-from-a-checkout-nobody-advances` (OPEN at the ref, and it stays open)
**Branch:** `claude/ffblock-mg` · **Worktree:** `wt-ffblock-mg` (sibling of the primary checkout) · **Base:** `f35487ecc`
**Rule 0:** `board renders from a stale checkout nobody advances tools/board.mjs` →
`tools/board.mjs:2-20`, `ext:fleet-units/tepna-board.service:28-38`,
`briefs/CROSS-DEVICE-DRIFT-FOLLOWUPS-2026-08-17-BRIEF.md:186-203`.

## What the row asks, and what a JS lane can actually build

The row says the board renders from a checkout nobody advances. The remedy it implies is a deploy:
either the unit moves to a fresh tree, or somebody advances the one it reads. Both are the owner's
call, and no edit to `tools/board.mjs` can reach the running renderer. The stale tree runs the stale
copy, so a fix that ships in the ref is a fix the service never loads. #4007 already shipped
`runnerVerdict`, which banners when the running copy differs from the ref.

What was never done is the cheap half: **deciding**. Something blocks the advance, and nobody knows
what.

## The defect, measured rather than argued

`git merge --ff-only` names every untracked file an advance would overwrite. It ranks none of them.
The selftest builds two clones and measures this directly: git lists a file byte-identical to the
ref's copy beside one holding local-only work, and says nothing about the difference. It is right
to refuse both. It will not overwrite an untracked file it did not write, whatever is in it. The
refusal just flattens two opposite situations into one list.

So the list sits. The reader would have to open every path to know which removals cost nothing.

## `tools/checkout-advance.mjs`

It reads a checkout and sorts every would-be blocker into four classes.

| class | blocks | meaning |
|---|---|---|
| `not-in-ref` | no | the ref has no such path, so an advance cannot touch it |
| `identical` | yes | the ref's blob equals the file on disk — removal loses nothing |
| `differs` | yes | the file holds lines the ref's copy does not, counted per path |
| `unreadable` | yes | the comparison did not run (§∅), and nobody may assume it matched |

It emits one `tepna.verdict/1` under criterion `paths_blocking_fast_forward ≤ 0`. It deletes
nothing, merges nothing, and writes nothing into the tree it reads.

**Measured on the primary checkout at `f35487ecc`:** 195 behind · 0 ahead · 0 modified tracked
files · 172 untracked paths · **112 blocking = 65 byte-identical + 47 differing over 81 local-only
lines + 0 uncompared**. The other 60 untracked paths are absent from the ref and block nothing.

**58 % of that list is a no-op, and git could not say so.** Removing those 65 paths loses no
byte. The 47 that remain are the ones somebody must read, and each names its own line count.

## Three rules the verdict holds, each a selftest

🔴 **AN UNFINISHED COMPARISON IS NEVER `identical`.** "I could not read the ref's copy" and "the
copies match" are one keystroke apart and opposite in consequence. One licenses a delete. The other
asks for a reader. An unfinished comparison is `unreadable`, carries `localOnlyLines: null`, counts
as a blocker, and is EXCLUDED from `population.checked`. Two plants prove the legs: reading an
unfinished comparison as identical reds one, and letting an unreadable path block nothing reds
another.

🔴 **A CHECKOUT THAT IS AHEAD FAILS, HOWEVER TIDY IT IS.** No value of the criterion can
fast-forward a tree holding its own commits, so the path census does not decide that case. The
tool settles the status before it weighs the population.

🔴 **AN EMPTY TREE IS `NOT_APPLICABLE`, NOT A PASS.** A checkout with no untracked path has no
population for the criterion to bind to. `verdict.js` refuses a PASS over zero examined paths at
the type level. The reason string says so in the object, so the next reader does not "fix" it into
a PASS.

## Gates

- `node tools/checkout-advance.mjs --selftest` ✓ 32, two plants red one leg each
- `node tools/verdict-adoption.mjs --check` ✓ — the tool is a `decides` producer, adopted, with a
  checkout-free `--verdict-sample`
- `npx --no-install biome check` ✓ · `node tools/tools-index.mjs` regenerated
- `npm run check` — result appended below

## Not in this PR

The row's closure. A measurement that makes the advance decidable is not the advance, and the 112
paths include 47 that hold work nobody else has. Which blockers may go is the owner's call, and the
row stays open until that call is made. The tool prints the list the call needs.
