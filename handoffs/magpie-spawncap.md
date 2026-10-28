# Magpie — unit `spawncap`

**Row:** `2026-10-27-a-fixed-spawn-timeout-makes-a-gate-step-red-under-box-load` (OPEN at the ref;
source `tools/verdict-adoption.mjs`)
**Branch:** `claude/spawncap-mg` · **Worktree:** `wt-spawncap-mg` (sibling of the primary checkout)
· **Base:** `22974e0d2`
**Rule 0:** `verdict adoption gate spawn timeout under load reports a failed adoption` →
`briefs/VERDICT-CONTRACT-2026-09-21-BRIEF.md`, `tools/workflow-timeout-guard.mjs`,
`ext:memory/a-cap-is-not-a-performance-target.md`.

## The row's premise held, and its remedy needed sizing

`runEmits` spawned every adopted producer with one `timeout: 120000` and no handling of the hit. A
cap hit arrived as an ordinary `spawnSync` error, so the gate reported a failed adoption and exit 1,
and `run-check` halted at step 38 of 41.

I timed every command the gate spawns before choosing: 166 adopted producers plus the one adopted
contribution, 167 in all. The other three adopted rows read a committed file and spawn nothing. Median 22 ms, p95 995 ms, 166 of them at or under
6.4 s, and one outlier: `tools/xerj-load.mjs` at 25.5 s idle and 1 m 48.7 s at load 44. No single
global cap serves both ends, so the default stays where it is and the outlier declares its own.

## What changed

- A cap hit is now `unexamined`, never an error. `unexaminedTimeout()` stamps the cap, the elapsed
  time, the one-minute load and the command; `check()` and `checkContributions()` route it to its
  own array and count it.
- Exit 2 means the gate could not look. Exit 1 keeps its meaning: it read a producer and the
  adoption failed. The precedent is the contract's own `find_unwired.py` note, where one exit code
  carried a finding and a crash at once.
- The summary reads `adopted N (validated X, unexamined Y)`, so a hidden population cannot pass as
  a checked one.
- A manifest row may carry `timeoutMs`, bounded at `MAX_EMITS_TIMEOUT_MS` (900 s). A malformed value
  reds before the producer runs, with `calls === 0` asserted.
- `tools/xerj-load.mjs` declares 240000 ms, twice the loaded observation, with the sample date and
  the two readings in its note.
- `CLAUDE.md` §4c gains the one measured exception to "contention slows a gate, it does not stop it".

## Gates

- `node tools/verdict-adoption.mjs --selftest` ✓ **132** (19 new)
- `npm run typecheck` ✓ · `npm run lint` ✓ · `npx --no-install biome check` ✓
- `npm run check` — result appended below and posted as a PR comment

## The plants

Two, each restored from a pristine copy afterwards. Reverting the routing so a cap hit lands in
`errors` reds 3 named assertions. Reverting the detection so the code never reads `r.signal` reds 2. The
detection leg spawns a real child that sleeps 30 s under `timeoutMs: 250`, with two controls beside
it, so it tests the thing rather than a stub of it.

The real-tree leg derives the declared caps from the committed manifest and holds an anti-vacuity
floor, because a frozen list of names ages.

## Not in this PR

The row's closure. A code PR does not touch the ledger here, so `fixed #<PR>` rides the RESIDUE-only
PR Kestrel sequences.
