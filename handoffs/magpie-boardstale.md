# Magpie — unit `boardstale`

**Order:** Kestrel, evaluation 2026-10-27 items 2 and 3. Three board defects, one PR, draft.
**Branch:** `claude/boardstale-mg` · **Worktree:** `wt-boardstale-mg` (sibling of the primary checkout) · **Base:** `a321fc236`
**Rule 0:** `fleet board release card reads an old tag plan pace negative evaluation heading skipped` →
`tools/board.mjs:294-330`, `briefs/RESIDUE.md:890`, `ext:memory/a-text-census-counts-the-text-explaining-it.md`.
**Claim:** board #1668, thread 7.

## The order's item (a) rested on a stale line number, and I report the correction

The order read: `tools/board.mjs:278` runs `git describe` in the primary checkout, so the release card
shows `v2.21.0` against a `v2.23.0` tag. **The ref already reads `origin/main`.** `release()` at
`tools/board.mjs:298` and `:303` take `MAIN_REF`, and `git log -S` names the commit that put it there:
`1bdfc4e34 fix(board): every card reads origin/main, not the lagging checkout (#3903)`. Line 278 is the
line number in the PRIMARY CHECKOUT's copy, which is a different file.

The card is wrong for a different reason. `tepna-board.service` carries `WorkingDirectory=%h/Tepna`, so
every ten minutes the timer runs the shared primary checkout's copy of `tools/board.mjs`, and that
checkout sat 167 commits behind `origin/main` on 2026-10-27. A fix that lands on the ref never reaches
the renderer. Measured the same morning: `git rev-list --count HEAD..origin/main` reads 167 in that
tree, and `git hash-object tools/board.mjs` there gives `982041ba3aee` against the ref's `8ecf8793d9ed`.

**Advancing that tree is not mine to do.** CLAUDE.md §👥.2 forbids touching a checkout I did not dirty,
other sessions work in it, and the unit file lives outside the repo, so editing it is a deploy. The
in-lane remedy ships here instead: the board states the condition rather than hiding it.

## What changed in `tools/board.mjs`

| defect | fix |
|---|---|
| the pace spans a weekly reset | `planRate(pts)`, exported and pure, keyed on the `resets` stamp |
| a `## ` evaluation heading slices nothing | `todaysEntries` accepts `#` through `######` before the words |
| the renderer lags the ref with no sign | `runnerVerdict(behind, boardDiffers)` plus a header banner |

**The pace.** The owner's percentage counts within one allowance week, so two readings are a pace only
while they carry the same `resets` stamp. The baseline is now the previous reading of that week. A week
holding one reading refuses with a named reason, because one reading is an absent measurement rather
than a slow week — §∅ makes it `null`, never 0. Live shape on 2026-10-27: 10-20 read `all: 41` under
`resets: 2026-10-24T16:00-04:00`, 10-26 read `all: 32` under `resets: 2026-10-31T16:00-04:00`, and the
card published `-0.06 %/h`, a fall in spend that never happened.

**The prefix.** The splitter matched `### ` or a bare `Kestrel daily evaluation — ` line, so a writer
using `## ` produced no split at all. 🔴 **The failure was not a blank card.** The whole file became one
undated part, `mine` went empty, the fallback showed the latest part, and the latest part was the entire
file. The note then contradicted itself: over a two-entry plant it read
`(no entry dated 2026-10-27; showing the latest, 2026-10-27)`. A card that shows everything looks fuller
than a card that shows today, which is why nobody read it as broken. The new pattern accepts the prefix
before those words and nowhere else — a bare `#{1,6} ` splitter would cut on every subheading inside an
entry body, and a selftest leg pins that.

**The tripwire.** `runnerVerdict` compares the running checkout with `MAIN_REF` on two axes, commits
behind and the hash of `tools/board.mjs` itself. Only the second raises the banner. A checkout behind on
commits that never touched this file renders the same board the ref would, so it reads `stale: false`
with a reason that says why. An uncomparable checkout is `null`, never `false`.

## Selftest

56 legs at the ref, 77 here. Each fix reds by name when planted back:

| plant | reds |
|---|---|
| the old `'### |Kestrel daily evaluation — '` splitter | 3 |
| `prev = rows[rows.length - 2]` | 2 |
| the differing-copy branch disabled | 1 |

Restoring each gives 77 of 77. Three of the new legs are controls: the legacy heading form, a `### <date>`
entry, and a behind checkout whose `board.mjs` matches the ref.

## Rows

Three new, in this diff. The two code defects close against this PR. The renderer row stays **OPEN**: the
tripwire makes it legible and the remedy is a deploy, which is the owner's. Row
`2026-10-25-a-refused-night-shaped-directory-reads-as-a-flat-root` closes `fixed #3985`, verified at the
ref: `rootLayoutVerdict` now takes the refused list as a third argument, the `2027-01-02/` plus one loose
file case returns `MIXED layout (night directories the NIGHT RULE refused)`, and `cb605d0ab` is the
commit.

## Gates

- `node tools/board.mjs --selftest` ✓ 77
- `npx --no-install biome check tools/board.mjs` ✓, and the base file carries the same empty diagnostic set
- `npm run check` — appended below

---

## FINISHED 2026-10-27 09:00Z — #4007 MERGED as `e40ef5bf8`, rows follow in #4008

`npm run check` read `BS_EXIT=0` over all 41 steps, suite **14,494 assertions over 831 groups**, on
the two-commit tree `12761e73fe1a`.

🔴 **MY PR MERGED WHILE ITS LEDGER COMMIT SAT UNPUSHED.** I pushed the code, opened #4007 as a draft
to obtain its number, wrote the four rows against that number, committed, and launched the gate before
pushing. During the run the PR was undrafted and merged, GitHub deleted the branch, and my later push
recreated an orphan branch carrying a commit squashed into `main` plus one commit nobody had seen.
The rows reached no PR at all, and `gh pr view` still answered with the merged number, so the loss
showed only in `git log origin/main -- briefs/RESIDUE.md`.

**The habit this costs:** a commit that depends on a PR number belongs in that PR *before* the gate
runs, or in a branch cut fresh from the ref afterwards. I took the second route: `claude/boardrows-mg`
from `origin/main`, the ledger commit cherry-picked, and the control is that the resulting tree hashes
to `12761e73fe1a`, the same tree the gate passed. The verdict covers this diff rather than a
predecessor of it. I deleted the orphan branch.

⚠️ A `git push` that prints `* [new branch]` for a branch you pushed an hour ago is this exact state.
Read it as a merge, not as a transient.
