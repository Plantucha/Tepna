# Magpie — unit `enumwire`

**Row:** a NAMED SLICE of `2026-10-21-forty-one-corpus-enumerators-report-no-population` (OPEN at the ref).
Osprey holds the row key (claim #1257); I took four names under the standing invitation at board #1024
and #1335, declared at #1590. Kestrel assigned the row at #1588.
**PR:** #3994 (DRAFT) · **Branch:** `claude/enumwire-mg` · **Worktree:** `wt-enumwire-mg` (sibling of the primary checkout) ·
**Base:** `d8f1fc31b`

**Rule 0:** `forty-one corpus enumerators report no population wiring a tool to report its population` →
`ext:agent-board/7/1010.md`, `ext:agent-board/7/1012.md`, `ext:agent-board/7/1310.md`,
`ext:agent-board/7/1335.md`, `ext:agent-board/7/1024.md`.

## What changed

Four tools were ONE walker written four times: the same recursive `readdirSync` collector over a
`--dir` capture tree, filtered by a stream pattern, sorted by size and capped by `--max-nights`. Each
now snapshots that tree through a named lister before and after the read, and prints the verdict.

| tool | unit | covered set |
|---|---|---|
| `resp-cardiac-suppression-e8.mjs` | H10 ACC files | `rows` |
| `ppg-foot-consensus-e1.mjs` | device PPG files | `scored` |
| `ppg-fusion-e3.mjs` | device PPG files | `rows` |
| `ppi-jitter-vs-ecg.mjs` | device PPG files | `nights` |

The scan reads all four as `reports`, so `UNWIRED_BACKLOG` drops them. It stands at 38 pinned names
with nothing unlisted and nothing stale.

## Three decisions the wiring turned on

🔴 **THE UNIT IS A FILE, SO `snapshotNights` WOULD MANUFACTURE THE POPULATION.** `--dir` is a capture
tree, not the `YYYY-MM-DD` root the night rule reads. `snapshotEntries` takes the caller's own lister
as the rule, and its header says an inline arrow publishes `rule: null`. Each lister therefore has a
name, and the output reads `rule listDevicePpg`.

🔴 **THE LISTER MUST NOT SWALLOW AN UNREADABLE ROOT.** `walk` catches every error, so a root nobody can
open returns `[]` and the snapshot would publish `n: 0` — a measurement of zero over a directory
nothing read (§∅). The root's own `readdirSync` runs outside that catch. **Control:** removing that one
line makes an absent root print the same sentence as an empty one, `offered no file at all`, instead
of `root not enumerable: ENOENT`. Restoring it separates them again.

🔴 **A RUN THAT SCORED NOTHING OWED ITS POPULATION AND PRINTED NONE.** All four exited early on an
empty result set, so the one case where the population is the whole story was the one case that
reported none. The early exit now prints it first.

## The finding this unit paid for, and it corrects a published figure

🔴 **WIRING THE PRESCRIBED REMEDY REMOVES THE TOOL FROM THE PROBE-SAFE POPULATION THAT MADE IT CHEAP.**
`corpus-scope.mjs` imports `execFileSync` and the writing half of `node:fs` at module scope, and
`closureHazards` reads a module's whole file text, so every importer inherits `exec@dep,fs-write@dep`.

| | backlog | probe-safe | hazardous |
|---|---|---|---|
| before | 42 | 11 | 31 |
| after | 38 | 7 | 31 |

All four read `NONE` before and `exec@dep,fs-write@dep` after, which is also what the already-wired
`ppg-gap-bridge-scan.mjs` reads. So the free half shrinks by exactly the number a unit wires, and
board #1335's free half is free to WIRE rather than free to verify. One bound survives: the class
move stays verifiable, because the suite group decides it by source scan and never runs the tool.
Logged as `2026-10-26-wiring-a-population-verdict-costs-the-probe-safety-that-made-it-cheap`.

⚠️ **THE FIGURES AGED BETWEEN THE COSTING AND THE UNIT.** #1335 read 44 and 14 at `e0126973e`; my base
reads 42 and 11. I re-measured rather than re-typing.

## Ledger

- Closed `2026-10-26-the-suite-night-rule-detector-reads-an-inline-rule-only` as `fixed #3990`, per
  Kestrel's #1588. #3990 merged at 21:23Z.
- Appended the probe-safety row above.

## Controls that were not mine

- Biome reds `noAssignInExpressions` at `tools/corpus-reads.mjs:173`. The same line reds at the base,
  so the diagnostic set is unchanged.
- `ste-lint` reports 10 findings on `briefs/RESIDUE.md`. The base reports the same 10, and a diff of
  the two sets is empty, so my row adds none.

---

## FINISHED 2026-10-27 01:10Z — gate green, one draft PR

`npm run check` ✓ `all 41 steps passed`, suite **14,470 assertions over 830 groups**, EXIT=0. No
`FAILED`, `ERROR` or `✗` line anywhere in the log. I detached the run per §4c and read the verdict
off its `EXIT=` sentinel, never off a tail.

Also green before the commit: `verdict-adoption --check`, each tool's `--selftest`, Biome over the
five changed JS files, and ste-lint over the handoff, the changeset and the PR body.
