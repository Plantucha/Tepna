<!--
  STATUS-SWEEP-METHOD-2026-08-27-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-08-27 · **Created:** 2026-08-27 · **Closes:** the 2026-08-27 status-verification sweep

# The open-brief count is approximately honest — 2 flips in 16 read

## 1 · What was expected, and what was measured

The sweep was commissioned on an estimate of **~20 of 47 IN-PROGRESS briefs being DONE in substance
with headers never flipped**. That estimate came from status-line counts.

Measured, over three batches:

| batch | read | flipped | date-corrected | correct as labelled |
|---:|---:|---:|---:|---:|
| 1 | 4 | 1 | 0 | 3 |
| 2 | 6 | 0 | 1 | 5 |
| 3 | 6 | 1 | 1 | 4 |
| **total** | **16** | **2** | **2** | **12** |

**Two flips in sixteen read.** Stated that way deliberately: not as a rate, and not projected onto the
remaining 31. A projection from this sample would be the same box-count-shaped inference that produced
the 20, differing only in its coefficient.

## 2 · Why so few flip — and it is not neglect

Of the fourteen not flipped, the blockers sort cleanly:

| blocker | n | examples |
|---|---:|---|
| physical / field-blocked | 3 | needs the box and a night; hardware the owner confirmed does not exist |
| unmade decision | 2 | routed and costed, waiting on a call nobody has made |
| genuinely unstarted work | 5 | items carrying *"Nothing is written for …"* |
| data-blocked | 2 | *"the corpus cannot yet decide"* — 6 of 12 nights usable |
| stale DATE only | 2 | label six weeks behind its own body; status itself correct |

**None was a stale label hiding finished work.** These briefs are open because the work is open.

⚠️ **Several are better-disciplined than the sweep sent to correct them.** `RUN-POLAR-MUTATION-PASS`
left half an item open with *"Left open rather than ticked on absence-of-evidence"*.
`KNOWN-CLOCK-ADVERSARIAL-CAPTURE` marks one *"(Correctly open — needs …)"*. Those authors had already
refused the flip this sweep was commissioned to make.

**The conclusion that matters upward: the open count is approximately honest.** The stale-header
population the estimate assumed was real earlier in the week and appears to have been drained by the
sweeps that ran then.

## 3 · Method — four rules, each bought by a specific case

### 3.1 · A handoff must be acknowledged on BOTH sides

`WEARABLE-HOST-AXIS-FOLLOWUPS` had ten of eleven items done and the eleventh handed off. It flipped
only because the receiving brief agreed: `PAT-NO-VALID-ANCHOR` exists, is IN-PROGRESS, and its header
records `Follows: WEARABLE-HOST-AXIS-FOLLOWUPS §F3-ter`.

> **A one-sided claim of handoff is a brief shedding an item.** The receiving brief must carry the
> `Follows:`/`Supersedes:` reference, or the item is still owed where it sits.

### 3.2 · Box counts do not predict flippability

| brief | boxes | outcome |
|---|---|---|
| `WEARABLE-HOST-AXIS-FOLLOWUPS` | 10 done / 1 open | **flipped** |
| `PPG-FOOT-PLACEMENT` | 7 done / 3 open | nowhere near |
| `R5-HR-TRIPLET-FOLLOWUPS` | 0 open, 1 `[~]` | not flippable |
| `PPGDEX-JITTER-AND-REFERENCE-FOLLOWUPS` | 5 done / 0 open | **not** flippable — header says §1's two figures remain open |

The last row is the important one: **all boxes ticked and still not done.** The Done-when *text*
decides, and reading it is the whole cost. This sweep has no cheap form.

### 3.3 · A park with a recorded reason is not a completion

`TCH-FUSED-ROBUST-HAT`'s remaining item is *deliberately not built* — landing the code plus a gate for
a path no committed input can exercise would be *"machinery that passes without checking anything"*.
That reasoning is correct and the item is still owed. **Parked-with-reason ≠ done**; it is the state
`[~]` exists for.

### 3.4 · Anchor every DOCS-INDEX edit on the filename cell

Status cells are **not unique keys**: `PROPOSED 2026-08-17` matches multiple rows, so a blind
substitution restamps an unrelated brief — silently, in a green PR. `docs-ledger` check3b catches a
*stale* row but not a *restamped wrong* row. Assert exactly one match, anchored on the filename, before
writing. (Measured by Papers, 2026-08-27.)

## 4 · Why the sweep stopped at 16 rather than 47

**The marginal batch is where over-flipping becomes tempting.** A sweep commissioned for ~20 flips that
has found 2 creates pressure to loosen the bar, and the failure mode is asymmetric:

- missing a flip leaves a **visible** debt — the brief stays open and someone re-reads it;
- an over-flip converts it into an **invisible** one — the brief reads DONE and nobody looks again.

The second is strictly worse and is the condition the sweep existed to remove. **A sweep should end
while its bar is still intact**, and the honest report is the measured number, not the commissioned one.

## 5 · Not claimed

- **Not** that the remaining 31 IN-PROGRESS briefs are all correct. They were not read. The claim is
  16 read, 2 flipped, and that the flip population is thinner than assumed.
- **Not** that the 12 correct-as-labelled briefs are near completion — several are blocked on hardware
  that does not exist.
- **Not** a rate. Two-in-sixteen is a count over a sample chosen oldest-verified-first, which if
  anything over-samples the stale end.
