<!--
  O2RING-BOOT-RECOVERY-DECISION-2026-10-28-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED (DECIDED 2026-10-28 — the owner chose option B, the full recovery with the numeric column; the build is unit 121) · **Created:** 2026-10-28

# The ring's recording axis has no boot recovery — what that costs, and the three ways out

Residue row `2026-10-27-o2ring-recording-axis-has-no-boot-recovery` waited on an owner decision. This
brief is that decision's record. It carries no code. It states what the recording axis loses across a
host restart, what is already built, what is left, and three options with their cost.

🔴 **The owner ruled on 2026-10-28: option B, the full recovery on the CPAP boot pattern, with the
numeric column.** `confirm_end` also gains a caller in the pull path, as its own unit. §6 records both
answers, and §7 holds the acceptance they ask for.

The row's parent is `OXYII-DAT-AUTO-HARVEST-REFINEMENT-2026-08-24-BRIEF.md` §10, whose restart table
left cases 2, 3 and 7 unexecuted. This brief traces all three and measures two of them.

## 1 · What is built

| fact | evidence |
|---|---|
| The recording axis is a pure in-memory engine | `capture-host/oxy_lifecycle.py:287` `OxyRecEngine` |
| It is fed by exactly two calls | `capture.py:6272` `observe_duration`, `capture.py:7172` `observe_link_lost` |
| It is constructed fresh per session, default `UNKNOWN` | `capture.py:6382` |
| Every transition is journalled | `OXYLIFE.csv`, `axis=rec` rows |
| The journal appends and survives a restart | row `2026-09-20-oxylife-truncated-on-every-restart`, `fixed #2715` |
| A lost link moves to `UNKNOWN`, never to `NOT_RECORDING` | `oxy_lifecycle.py:378` plus three tests |

The engine has no load path, no restore path and no replay path. Nothing anywhere reads `OXYLIFE.csv`
back: `writers.py:3158` states that timeline, webmon and tools carry no OXYLIFE reader. So the axis is
write-only across a process boundary.

`oxy_restart.py` is not this. Its `plan()` reconciles downloaded `.dat` bytes against the inventory
ledger. It never asks what the ring was doing.

## 2 · What a restart actually loses

A restart drops four fields: `state`, `prev_duration`, `closed_at_duration` and `history`. The axis
reopens at `UNKNOWN` and stays there until two frames arrive whose durations strictly increase.

**Case 7 — the link drops during recording — is not a durability case.** It is one in-process
transition, and it is built and tested. `observe_link_lost` moves any state to `UNKNOWN` and forgets
the counter. Three tests pin it: `tests/test_oxy_rec_axis.py:209`, `:221` and `:233`. §10's table
should be read as answered, not as unexecuted.

**Case 2 — the host restarts during recording — loses only self-healing state.** `RECORDING` is
re-derived from the device's own counter at the next two frames. Measured on vigil, the axis regained
`RECORDING` from `UNKNOWN` 69 times, median 38.3 s. One in ten of those spells ran for hours, because
ignorance holds until the ring is next seen. Nothing in the daemon re-establishes the state sooner.

**Case 3 — the restart lands on an open END_CANDIDATE — loses a number held nowhere else.**
`closed_at_duration` is the ring's own session length at the moment the counter stepped backward. The
pull path needs it to confirm an end. It survives in the journal only inside a prose reason string:
`duration_s reset (prev→new) — session closed at Ns`. The rec rows carry no numeric column for it.

## 3 · Measured exposure on vigil (read-only, 2026-10-28)

66 journals, 117082 rows, 2576 of them on the recording axis, spanning 2026-08-26 to 2026-10-28.

| measurement | value |
|---|---|
| recording windows reconstructed | 688 |
| windows that closed on a real `recording →` exit | 688 of 688 |
| recorded time covered | 403.1 h |
| daemon starts in journald's coverage (2026-09-07 onward) | 427 |
| windows inside that same coverage | 76 |
| **daemon starts falling inside a recording window** | **0** |
| `recording → rec_unknown` events, which is case 7 in production | 325 |
| `END_CANDIDATE` spells | 363 |
| `END_CANDIDATE` dwell | p50 3.3 s, p90 39.2 s, max 332.2 s |
| total time spent in `END_CANDIDATE` | 4076 s, which is 0.28 % of 403.1 h |
| `END_CONFIRMED` occurrences | 0 |

Two independent readings agree that no restart has yet landed mid-recording. The direct one intersects
427 starts with 76 windows and finds none. The structural one is stronger over the whole span: a
restart mid-recording leaves a window with no `recording →` exit row, and all 688 windows have one.

That zero is not luck. `tepna-update.sh` holds a recording interlock and defers the restart while a
device is recording. So planned restarts land when the box is idle, and only a crash, a power loss or
a kill can land inside a window.

## 4 · What is left, and one finding the row did not ask for

The absent piece is a reader, not a journal. The durable substrate exists.

🔴 **`END_CONFIRMED` is unreachable in the running daemon.** Its only producer is
`oxy_lifecycle.py:387` `confirm_end`, and that method has no caller outside
`tests/test_oxy_rec_axis.py`. The journal agrees: 363 end candidates, 0 confirmations, over nine
weeks. So the axis cannot today confirm an end even without a restart, and case 3's loss has no
consumer yet to harm.

Row `2026-10-28-end-confirmed-has-no-producer-outside-its-tests` records that finding. Kestrel ordered it into this PR
with the ruling, so it rides here rather than on a separate ledger PR. The owner's second answer
closes it: `confirm_end` gains a caller in the pull path, as unit 122.

## 5 · The reference pattern, and what it would cost here

The CPAP side already solves this shape. `_cpap_autostart_boot` reads the journal and decides nothing;
a pure function decides. Its own comment states the whole design: reads two files, decides nothing.

| part | reference | lines |
|---|---|---|
| journal parser | `cpap_live.journal_rows` | 20 |
| pure boot decision | `cpap_live.boot_start_state` | 42 |
| thin boot reader | `capture.py:_cpap_autostart_boot` | 19 |
| the sibling it mirrors | `cpap_live.boot_state` | 61 |

It bounds itself by age: `CATCH_UP_MAX_AGE_S` is 86400, and a last row older than that does not
describe now. An O2Ring equivalent needs the same bound, because a night-old journal row says nothing
about the ring in front of the host.

### Option A — leave it write-only, and add a tripwire

Keep the axis self-healing. Add a standing count of restarts that land inside a recording window.

- Cost: a small reader in the night-QC path, plus its tests. Call it half a unit.
- Buys: the exposure number stays measured instead of assumed, on every box, from day 1.
- Leaves: case 3's `closed_at_duration` still lost on an unplanned restart.
- Honest against: the measured exposure is already zero over nine weeks and 403 h.

### Option B — mirror the reference pattern in full 🔴 CHOSEN 2026-10-28

A pure `boot_rec_state(rows, now_ms)` plus a thin reader, restoring `state` and the counter.

- Cost: about 120 lines of module code by the reference's own shape, plus roughly 15 tests. One unit.
- Also needs: a numeric column on the rec rows, because the number now lives in prose.
- Buys: every case in §10's table answered by one mechanism, with an age bound.
- Honest against: it restores `RECORDING`, which the device re-establishes by itself in 38 s.

### Option C — restore `END_CANDIDATE` only

Restore the one state whose data exists nowhere else, and let `RECORDING` keep healing itself.

- Cost: the same numeric column, a narrower pure function, about 40 lines plus tests.
- Buys: the pull path can confirm an end that a restart interrupted.
- Leaves: `RECORDING` and `NOT_RECORDING` unrestored, by choice, with the reason written down.
- Honest against: it buys a guarantee for a consumer that does not exist yet (§4).

The column is common to B and C, and no later option can skip it. That is the part worth landing
first whichever way the decision goes.

**What I would do:** option A now, option C once `confirm_end` has a caller. The measured exposure is
zero, the axis heals itself in half a minute, and the state C protects has no consumer today. A
tripwire keeps the zero honest; building recovery first would protect a number nobody reads.

## 6 · The ruling, 2026-10-28

The owner answered both open questions, and Kestrel relayed them on board thread 7.

1. **Option B** — the full recovery on the CPAP boot pattern, with the numeric column. Unit 121 builds
   it. My own reading preferred A, on the measured exposure of zero. The ruling stands over that
   reading, and §3 keeps the numbers for whoever revisits it.
2. **`confirm_end` gains a caller in the pull path**, as unit 122. That answers §4's finding, and row
   `2026-10-28-end-confirmed-has-no-producer-outside-its-tests` carries it.

A deploy to vigil stays owner-only. Unit 121 ships code and restarts no daemon.

## 7 · Acceptance

- [x] This brief's status line names option B, with the date.
- [x] Row `2026-10-28-end-confirmed-has-no-producer-outside-its-tests` rides this PR.
- [ ] Unit 121 gives the rec rows a numeric column for `closed_at_duration`, with a writer test.
- [ ] Unit 121's pure function takes journal rows and an age bound. It owns no clock.
- [ ] Unit 121 bounds the journal's age, as `CATCH_UP_MAX_AGE_S` bounds the reference.
- [ ] Unit 121 restores `END_CANDIDATE` and `closed_at_duration`, not `RECORDING` alone.
- [ ] §10's case 7 reads answered, and names the three tests.
- [ ] Unit 122 wires `confirm_end` in the pull path, and closes the row.
- [ ] `capture-host/check.sh` passes at the 100 % floor on both units.
