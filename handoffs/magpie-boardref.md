# magpie · boardref

**Unit:** residue row `2026-10-27-the-board-renders-from-a-checkout-nobody-advances`, ordered by
Kestrel. **Branch:** `claude/boardref-mg`. **Worktree:** a sibling of the primary checkout, cut from
`origin/main` at `30570196e`.

**Rule 0:** `the board renders from a checkout nobody advances so a card is stale while its inputs are
correct` → `briefs/BLANK-ON-PRINT-FLEET-2026-08-03-BRIEF.md`, board #513,
`memory/an-open-row-at-the-ref-cannot-see-a-merged-fix.md`, `capture-host/tests/test_monitor_ble_card.py`.
The hits name the stale-checkout trap three times over and no prior work touches the board's banner
levels.

## What I found

The detection half of the row already landed. #4007 added `runnerVerdict` and #4038 widened it to the
renderer's whole executable closure, derived rather than typed. What nobody had looked at is where
that verdict LANDS on the page.

It landed in the header as `<div class="meta">`: 12 px, `--dim`, the same class and size as the
generated-at stamp, the host name and the URL beside it (`tools/board.mjs` CSS, `header .meta`). A
failing CI run, by contrast, renders through `.banner` at 18 px bold inside a bordered block. The one
condition that puts every number below it in doubt was the quietest thing on the page, which is the
row's own warning: a reader cannot tell a stale renderer from a stale input.

## What I changed

Two pure functions in `tools/board.mjs`, ten planted cases, three of them controls:

- `runnerBanner(runner)` — measured drift takes `red`, an uncomparable or failed runner section takes
  `amber`, a matching renderer returns `null` however far behind it sits. The reason comes from
  `runnerBannerText`, so the two surfaces cannot drift apart.
- `withRunnerBanner(banners, runner)` — the qualifier goes first, ahead of the banners it doubts, and
  it copies the caller's list rather than splicing it.

The header's duplicate dim line is gone. `summarize` picks the red one up at no cost, since it
already prints every red banner.

## What stays open

The row. The renderer still runs whatever the shared checkout holds, and advancing that tree or
pointing `tepna-board.service` at a dedicated one is a deploy outside the repo, so it is the owner's.
I put the choice on thread 8: advance the tree by hand each time, point the unit at a checkout a timer
keeps current, or let the board re-exec the ref's own copy of its closure, which one advance
bootstraps and which then never goes stale again. The third option makes the daemon self-updating,
which is why it is a question rather than a commit.

## Gates

`node tools/board.mjs --selftest` reads `all 117 selftests passed`. Biome clean. `npm run check` ran
on the final state.
