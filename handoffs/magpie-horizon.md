# magpie · unit `horizon`

Row `2026-10-28-the-horizon-tripwire-judges-a-one-level-night-population`. Branch `claude/horizon-mg`.

Rule 0: `node tools/doc-search.mjs --read "the horizon tripwire judges a one-level night population"` → board #1537, #1530 and #1347. Heron built the tripwire in unit `yearhz`, Osprey censused the year rules, and no prior work measures the collector's depth.

## What moved

- `corpusNights` in `tools/night-rule-horizon.mjs` walks each documented root at any depth, through `nightDirsUnder` and an injected walker. The CLI passes the shipped `findDirNames`.
- The verdict carries `nightsDepth` beside `nightsOffered`, and each root row carries `directories` beside its name count. A root nobody could walk reads `null`, never zero.
- The hand-added `uploads/trio` root leaves the CLI. It sat beside `uploads` because the walk read one level, and the recursive walk reaches it from the parent.
- Eight selftest legs cover the collector, which had none before. They plant a nested name, an empty walk and an unwalkable root. Two more cover an absent walker and both readings of the depth field.

## What the measurement says

The union does not move: 176 night names before and after, on this machine today. Three of the five readable roots offered ZERO names to the one-level read while holding 109, 147 and 2 one level down. Every one of those names also sits in a root the flat read could see. So the gap was coverage, and overlap masked it.

## State

The selftests read `all 33 selftests passed`. Typecheck and lint pass. `npm run check` runs on the final state before the push.

Fleet-Session: Magpie
