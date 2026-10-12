<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-10-11 · **Owner ask:** 2026-10-11 ("spend tokens to save tokens", "do it now") · **Measured on:** the fleet's own transcripts, 2026-10-05 → 2026-10-11 · **Tool:** `tools/fleet-turns.mjs`

# The token diet: five rules, each with a measure — plus two the owner added on 2026-10-11 evening

## 1 · What the money goes to

A turn is one model call. Every call re-reads the whole context window. The output is small. The window is the cost.

| measure (fleet, 2026-10-11, four sessions) | value |
|---|---|
| context read per turn, median | 363k–658k tokens |
| context read per turn, p90 | 539k–917k tokens |
| output per turn, mean | 0.7k–1.0k tokens |
| share of fresh tokens that were cache rewrites | 81 % |
| tool results per day, fleet | ≈0.2M tokens |
| CLAUDE.md per turn | ≈9.5k tokens (≈2 % of a turn) |

Two levers follow. The window size, which PR #3447 cut by compacting at 20 %. The number of turns, which this brief makes a fleet rule with a counter.

The turn counter shows where the turns go. Three of four birds write a text message on 56–60 % of the turns that also call a tool. Their tool calls per turn are 0.87–0.97. One call per turn, with a sentence before it, is the fleet's habit.

| session, 2026-10-05 → 10-11 | turns | tools per turn | narration turns |
|---|---|---|---|
| Magpie | 2575 | 0.96 | 56 % |
| Kestrel | 2113 | 1.21 | 5 % |
| Heron | 2072 | 0.91 | 56 % |
| Osprey | 2059 | 0.95 | 60 % |

Source: `node tools/fleet-turns.mjs --since 2026-10-05`. The counter reads the local transcripts line by line. It prints no verdict. A target is the owner's to set from two days.

## 2 · The five rules

Each rule names its owner, its state and its measure. The owner approves the CLAUDE.md text in §3.

| # | rule | owner | state 2026-10-11 | measure |
|---|---|---|---|---|
| 1 | One session per work-unit. A bird starts from a short handoff file, finishes, exits. | Heron (launcher) + Kestrel (contract) | assigned 2026-10-11 evening, branch `claude/unit-launch-hrn` | sessions longer than one unit: 0 |
| 2 | Never park loaded. A waiting bird keeps a cheap heartbeat under an hour, or exits and resumes from the handoff. | every bird | proposed | `fleet-turns.mjs`: p90 context of an idle session |
| 3 | Fewer turns. Batch independent tool calls in one turn. Act, do not narrate between calls. | every bird | proposed | `fleet-turns.mjs`: tools per turn up, narration share down |
| 4 | Trim tool output through a hook. Head, tail and a count before it enters context. | Osprey | assigned 2026-10-11 evening, branch `claude/trim-output-osp` | hook tests; saving stated as measured, ≈0.2M/day fleet |
| 5 | Skills for the recurring procedures, auto-invoked. | Magpie | 9 skills staged in `claude/fleet-skills-mg`, no PR yet | the 48 h slips they would have caught |
| 6 | **Window cap.** A bird compacts or exits before its window passes 300k tokens. The fixed floor is 70–80k; everything above it is accumulated conversation. | owner (the compaction setting is a settings edit) + every bird (compact or exit at a unit boundary) | ordered 2026-10-11 22:50 ("add the window cap") | `fleet-turns.mjs`: ctx/turn median ≤ 300k, p90 ≤ 400k per bird |
| 7 | **Tools per turn ≥ 2.0.** Every independent tool call goes in the same turn; a turn with one tool call and a sentence is the pattern to kill. | every bird | ordered 2026-10-11 22:50 ("add the tools-per-turn target") | `fleet-turns.mjs`: tools/turn ≥ 2.0 per bird; the tool prints the target and flags the miss |

### 2b · Why these two, measured 2026-10-11 (04:00 → 22:30 EDT, every turn classified by its trigger)

| bird | turns | owner msg | peer msg | loop tick | tool result | window median | window max | tokens read |
|---|---|---|---|---|---|---|---|---|
| Osprey | 603 | 12 | 13 | 0 | 577 | 635k | 869k | 357M |
| Kestrel | 589 | 69 | 46 | 0 | 472 | 529k | 967k | 280M |
| Magpie | 485 | 10 | 4 | 0 | 471 | 344k | 967k | 234M |
| Heron | 401 | 13 | 14 | 0 | 356 | 358k | 578k | 135M |

About 1.0 G tokens read in one day. 90 % of turns are tool-result turns: one tool call, one re-read of the window.
Loop ticks were zero, peer messages about 4 %, the fixed floor about 16 % of the reads. The two levers that
remain are the window (rule 6) and the number of turns per unit of work (rule 7). A window held near 200k against
a 500k median halves the reads; two tools per turn against 1.0 halves the turns. The two multiply.

Windows reached 967k before compaction today, so the compaction setting in force does not cap the window. The
value that caps it near 300k is the owner's to set in the project settings; a bird does not edit settings.

## 3 · Proposed CLAUDE.md text (the owner edits CLAUDE.md, not a bird)

Add under §👥, after §5 · Landing:

```
### 6 · Tokens: the window is the cost (owner, 2026-10-11; brief TOKEN-DIET-2026-10-11)

- **One session per work-unit.** Start from `handoffs/<unit>.md`, finish, write the handoff back, exit.
  No multi-day sessions. `tools/unit-launch.sh` starts one.
- **Never park loaded.** A bird that must wait keeps a heartbeat under an hour, or exits and resumes
  from its handoff. A session idle with a full window pays for the window at every heartbeat.
- **Fewer turns.** Put every independent tool call in one turn. Do not write a sentence between calls.
  Measured per bird by `node tools/fleet-turns.mjs`; read your own row before you start.
- **Write the handoff before you stop,** at every unit boundary and before a compaction: unit, branch,
  worktree, the exact stopping point, the next step, open questions, the doc-search query that found
  the prior work. The index is the memory; the note is what the index finds.
- **Tool output is trimmed by a hook** (`trim-output.sh`): over 200 lines you see the head, the tail,
  a count and a path. Read the file when the tail is not the verdict (§4b).
- **Window cap 300k.** Compact or exit at a unit boundary before the window passes 300k tokens. The floor
  is 80k; the rest is conversation you carry. Write the handoff first.
- **Two tools per turn.** `fleet-turns.mjs` prints tools/turn with its target (≥ 2.0) and the window
  median with its cap. A row that misses either is the first thing to fix in your next unit.
```

## 4 · Handoff file contract

`handoffs/<unit-slug>.md`, under 40 lines, in the repo, STE style. Fields:

```
unit:        one line, what done looks like
bird:        Heron | Osprey | Magpie | Wren | Finch | Kestrel
branch:      claude/<slug>-<3>
worktree:    ../wt-<slug>-<3>
doc-search:  the query that found the prior work, and its top hit
state:       NEW | IN-PROGRESS | BLOCKED | DONE
stopped-at:  the exact point (file, line, test name, PR number)
next-step:   one instruction
open:        questions only the owner or another bird can answer
done-when:   the acceptance list, one item per line
```

Heron's launcher reads this file. The bird writes it back before it exits. A handoff with no `stopped-at` is not a handoff.

## 5 · What this brief does not claim

- It does not claim the saving. The measure is the counter, run on the day after the rules apply, against the table in §1.
- It does not change a bundle. No `manifestHash` moves.
- It does not copy the writing-rules dictionary (PR #3448 owns that line).

## Done-when

- [ ] the owner has approved or edited §3 and CLAUDE.md carries it
- [ ] `tools/unit-launch.sh` lands with one real launch shown to the owner (Heron)
- [ ] `trim-output.sh` lands with its tests (Osprey)
- [ ] the skills PR lands (Magpie)
- [ ] `fleet-turns.mjs` run on the first full day under the rules shows narration below 20 %, tools per turn at or above 2.0 and a window median at or below 300k on every bird, or the brief records why not
- [ ] the owner has set the compaction value that caps the window near 300k (today it reached 967k)
