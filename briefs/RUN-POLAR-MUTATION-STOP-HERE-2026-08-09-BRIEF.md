<!--
  RUN-POLAR-MUTATION-STOP-HERE-2026-08-09-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED · **Created:** 2026-08-09 · **Follows:** `RUN-POLAR-MUTATION-PASS-2026-08-08-BRIEF.md`

# `run_polar` — four families closed, and the case for stopping there

The parent brief opened the fleet's largest unit. This one closes the question the parent could not
answer until the work had been done: **how much of the remaining 183 is worth buying.**

The recommendation is **stop after the four closed families, take one more (`reconnect / bonding`, 35)
only if a real incident argues for it, and explicitly decline the rest.** The reasoning is below, with
the cost data, because "we ran out of appetite" is not a reason a later reader can check.

## 1 · What was bought

| family | mutants | killed | equivalent | tests | what it protects |
|---|---:|---:|---:|---:|---|
| `BUS.*` — the live view | 69 | 66 | 3 | 12 | every monitor card's identity + the two-phase negotiated rate |
| `_set()` — the status card | 45 | 43 | 2 | 17 | `status.json`, `monitor.html`, everything `alerts.py` keys on |
| writer dispatch — the durable record | 22 | 12 | 10 | 10 | PSL column order in the files that ARE the night |
| bounded awaits | 9 | **9** | 0 | 7 | the 2026-07-25 silent freeze — 4 h 25 m behind a green card |
| **total** | **145** | **130** | **15** | **46** | |

Every kill confirmed by re-applying the mutant. Every equivalent PROVEN, not asserted.

## 2 · What is left, and what it is worth

**183 survivors + 13 unjudged loop-condition timeouts**, against 400 REACHABLE.

| family | count | verdict |
|---|---:|---|
| other | 59 | **decline** — the residue after seven named families; no shared fixture, so each is its own setup |
| reconnect / bonding | 35 | **conditional** — see §3 |
| negotiation + decode | 33 | **decline for now** — `polar_pmd` is separately swept; these are its CALL sites |
| backoff / sleep cadence | 29 | **decline** — see §4, the strongest argument in this brief |
| loop / branch conditions | 12 (+13 timeouts) | **judge first, cheaply** — §5 |
| device clock + skew | 12 | **conditional** — the only honest confirmation a sync took |
| stall + worn watchdog | 8 | **decline** — the predicates are already extracted and covered |
| PMD control-point I/O | 4 | **done** — the rest went with the bounded-await family |

## 3 · Why `reconnect / bonding` (35) is the only one with a claim

It is the one remaining family with a **measured incident** behind it. On 2026-07-29 an H10's bond went
stale, `ensure_bonded`'s re-pair removed it and could not re-establish it, and nothing tried again: the
task spent **4.5 h** connecting and being torn down every ~70 s with no path to recovery, and 4.5 h of
ECG was lost. `maybe_rebond` and the two-strike `stale_bond_hits` rule exist because of it.

Four of those mutants are already dead (the `_set` pass drove the re-pair path for its card messages).
The remaining ~31 are the counters and cadence around them.

**Take it only if that recurrence matters more than the next thing on the roadmap.** It is not free:
the fixture family for a multi-iteration reconnect is the expensive kind — `_stop_after(…, 1)` does not
reach it, so each test drives several loop iterations with a patched clock.

## 4 · Why `backoff / sleep cadence` (29) should be DECLINED, not deferred

This is the clearest case, and it generalises.

Killing `backoff = min(backoff * 2, 60)` → `* 3`, or `60` → `61`, requires asserting the exact sleep
SEQUENCE a session produces. That pins a tuning constant in a test, and the constants here are tuned
against a live radio: `CHARGE_RETRY_S`, `_STALL_RECONNECT_S`, `_NOT_WORN_RECHECK_S`, `_REBOND_EVERY`
have all moved in response to measurement, and each move would then red the build in a file that has
nothing to say about whether the new value is better.

That is the same trade `CAPTURE-HOST-MUTATION-FLEET` §5 already refuses for `flush=` and `XX`-wrapping,
and the same one this suite made deliberately for **message wording** (161 mutants → PROSE, 2026-08-08).
**The rule is worth stating once, generally:**

> A mutant that can only be killed by asserting a value chosen by tuning is not a defect the suite
> should own. Pin the BEHAVIOUR the constant produces (backoff grows; it is capped; a stall reconnect
> is faster than an error backoff) and let the number move.

Three of those behavioural facts are already pinned by the closed families. The remaining 29 are the
digits.

## 5 · The 13 loop-condition timeouts — judge before buying

These mutate a loop's exit condition (`and not _STOP.is_set()` → `or`) and make `run_polar`
non-terminating. Before writing anything, answer one question, and it is cheap:

**Is the non-termination real, or an artefact of `_stop_after`?** The fixture patches `asyncio.sleep`
to a no-op that trips `_STOP` after N calls. A loop that no longer awaits a real sleep therefore never
sees `_STOP` — in production the same mutation spins at 0.3 s intervals and DOES exit on shutdown. If
that is the whole story, these are fixture artefacts and must not be counted as findings.

One run with an unpatched sleep and a real deadline settles it. **Do not write tests for these until
that is known** — this is exactly the "confident wrong answer from the instrument" the parent brief's
§5.4 is about.

## 6 · What actually predicted value — the generalisable part

The parent brief said concentration predicts *cost*. This pass says something different about *worth*,
and the two do not agree:

* **The most valuable family was the SMALLEST.** Bounded awaits: 9 mutants, 7 tests, and it protects a
  documented 4 h 25 m silent data loss. The largest (`BUS`, 69) protected two real defects. `backoff`
  at 29 protects a tuning constant.
* **The predictor is a NAMED INCIDENT, not a count.** Every family worth closing had one in the code's
  own comments — 2026-07-25 (freeze), 2026-08-05 (vendor rate → amber all night), 2026-07-19 (the
  missing `bpm` card), 2026-07-29 (4.5 h of ECG). The families with no incident behind them are the
  ones this brief declines.
* **The instrument found a class the reading never would.** The bounded-await family was invisible to
  every prior sweep because those mutants HANG rather than fail; a run with no per-mutant timeout waits
  forever. One of them had burned 79 minutes of CPU before anyone noticed. **Adding the timeout was
  worth more than any single test in this pass.**

## 7 · Instrument changes that outlive this work

These are cheap, reusable, and each one had already produced a confident wrong answer:

| change | what it stops |
|---|---|
| per-mutant **timeout** | a hanging mutant stalling a sweep forever; a hang is now its own verdict, never a kill |
| restore in **`finally`** + `atexit` | a killed run leaving `capture.py` MUTATED on disk (it did) |
| **baseline guard** | two test paths passed as one argv element → pytest exits non-zero → **264/264 "killed" with nothing collected** |
| **verified line map** (body offset → absolute line, re-checked against source) | text anchors silently SKIPPING 17 of 45 mutants and reporting 13/45 as if measured |
| **progress line** | a 1 h 42 m run that could not be distinguished from a hang without reading `/proc` |

## 8 · Done when

* §5's one measurement is run and the 13 timeouts are recorded as real or artefact. **Nothing is
  written for them first.**
* A decision is taken on §3 (`reconnect / bonding`) — take it or decline it in writing.
* §4's rule — *a mutant killable only by asserting a tuned constant is not the suite's to own* — is
  added to `MUTATION-AUDIT-RUNBOOK` beside the ceiling rule, so the next pass does not re-derive it.
* The remaining families are marked DECLINED in `CAPTURE-HOST-MUTATION-FLEET` with the reason, so
  `run_polar` is not re-opened as if it were untouched.
