# Magpie — unit `boardclos`

**Row:** `2026-10-27-the-board-renders-from-a-checkout-nobody-advances` (OPEN at the ref, and it stays open)
**PR:** #4038 (DRAFT) · **Branch:** `claude/boardclos-mg` · **Worktree:** `wt-boardclos-mg` (sibling of the primary checkout) · **Base:** `c2d769c2c`, rebased onto main carrying #4037
**Rule 0:** `the board renderer banner only compares one file so a stale module in its import closure stays invisible` →
no prior work, best score 0.089 under the 0.105 floor. Nearest reads were `ext:agent-board/7/1407.md:19-25`
and `briefs/ESM-MIGRATION-SPIKE-FINDINGS-2026-07-15.md:55-69`, neither on this question.
Sized on board #1810. The `ffblock` unit (#4037) sits beside this one on the same row.

## What the row asks, and what this unit does

The row's remedy is a deploy. Advancing or repointing the checkout is the owner's call, and this
unit does neither. The row names a second gap in its own evidence cell, and nobody had built it:
#4007's banner **"stays silent for a checkout merely behind on commits that never touched the
file."**

## The banner checked one file and spoke for the renderer

`runner()` hashed `tools/board.mjs` alone. When that matched, `runnerVerdict` returned `stale:
false` with a sentence about one file, which reads as a verdict about the whole renderer.

The renderer runs more code than that. Its executable closure is four repo files: `tools/board.mjs`,
the `tools/argv-guard.mjs` it imports, and two tools it SHELLS OUT to from the running tree —
`tools/release-land.mjs` for the release card and `tools/usage-guard.mjs` for the usage card. The
release card is the one the row's incident is about.

| measurement | at `c2d769c2c` |
|---|---|
| commits that ever touched the closure | 24 |
| of those, commits that never touched `tools/board.mjs` | **9** |
| primary checkout, behind | 196 |
| closure files drifting there | **3 of 4** — `board.mjs`, `release-land.mjs`, `usage-guard.mjs` |
| of those, visible to the old one-file check | 1 |

## What changed

`rendererClosure(entryRel, readText)` derives the population instead of freezing it. It follows
relative `.mjs` imports and `path.join(REPO, 'tools', 'x.mjs')` call sites, transitively, with the
reader injected. **It fails closed.** A parse that matches nothing returns a refusal, because an
empty population reads clean under every later question.

`runnerVerdict(behind, drift)` now takes `{ drifted, unreadable, examined }` and keeps the old
boolean working. A boolean reports on `tools/board.mjs` and says so, rather than borrowing the wider
sentence.

`runnerBannerText(runner)` replaces the header's `b.runner.stale` test.

## Two rules, each a selftest

🔴 **A FILE THAT COULD NOT BE COMPARED IS `null`, NEVER `false`.** "I could not look" and "they
match" are opposite answers (§∅). An unreadable dependency lands in `unreadable`, keeps out of
`examined`, and makes the verdict `null` with a reason.

🔴 **THE HEADER DROPPED BOTH ABSENCE SHAPES.** `stale === null` and a failed `runner` section are
both falsy, and the old test fired on truth alone. The two states an operator most needs to see were
the two that printed nothing. The all-clear is the only quiet case now.

## The derived list caught what my own grep missed

My sizing note said three files, because I read the call sites with a grep for `sh('node'` and the
`usage-guard.mjs` call site wraps onto the next line. The derived reader found four. The history
figures moved with it, from 21/6 to **24/9**. That is the argument for deriving a population rather
than typing one, demonstrated against the person making it.

## Gates

- `node tools/board.mjs --selftest` ✓ 108, and a scratch render (`TEPNA_BOARD_DIR` into a temp dir)
  raises the widened banner against the live tree
- three plants: dropping the shelled-out reader reds 3 legs including the real-tree one · letting an
  empty closure read clean reds 1 · restoring the old truthy banner test reds 2
- `npx --no-install biome check` ✓
- `npm run check` — result appended below

## Not in this PR

The row's closure. A banner that names more files does not advance the tree, so the row stays OPEN
for the owner's deploy.
