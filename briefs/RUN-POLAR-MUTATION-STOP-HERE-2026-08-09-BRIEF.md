<!--
  RUN-POLAR-MUTATION-STOP-HERE-2026-08-09-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-08-15 (all four Done-when items: §5 MEASURED and its hypothesis REFUTED, §3 declined on journal evidence, §4's rule in the runbook, the declines recorded in the fleet brief) · **Created:** 2026-08-09 · **Follows:** `RUN-POLAR-MUTATION-PASS-2026-08-08-BRIEF.md`

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

## 5-RESULT · MEASURED 2026-08-15 — the hypothesis is REFUTED, and the answer is not uniform

§5 asked whether the 13 loop-condition timeouts were real non-termination or an artefact of
`_stop_after`, and offered a mechanism: *"a loop that no longer awaits a real sleep therefore never sees
`_STOP`"*. **That mechanism is wrong** — the loops in question do await a real sleep. Measured by running
the real `run_polar` under the **real `asyncio.sleep`** with a real deadline, one mutant at a time:

| site | mutant | real sleep + `_STOP` set |
|---|---|---|
| hold loop | `client.is_connected and not _STOP` → `or` | **HUNG** (8 s ceiling) |
| …same, plus the link dropped | | EXITED 1.20 s |
| pause loop | `(paused or recovering) and not _STOP` → `or` | **EXITED** 1.20 s |
| …same, with the pause HELD | | **HUNG** |
| unmutated control, every arm | | EXITED 1.20 s |

**So the operator is not what decides it.** A `… and not _STOP.is_set()` → `or` mutant is real exactly
when its **sibling condition can still be true at shutdown**, because `or` then makes `_STOP`
unreachable. For the hold loop that sibling is `client.is_connected` — true by definition during a
session and cleared only by the `finally` *after* the loop, so nothing inside the process can end it.
For the pause loop it is transient, which is why the same mutation looks inert in the ordinary path and
is fatal when a pull owns the link at shutdown.

**Neither "all real" nor "all artefact" was the answer, and one site would have produced either.** The
first site alone says *real*; the second alone says *artefact*. This brief family's recurring error is
generalising from one file (§3 of the parent, and its own §4 warning), so the second site was measured
before anything was written — and it changed the conclusion.

**Two tests now gate it, and they cost 0.56 s.** §5 feared these were expensive; they are not, once the
mechanism is known. Both drive the real runner with a real sleep — under `_stop_after` they would pass
against the mutant, which is the whole finding — and use `_run_bounded`, so a regression **fails at 6 s
instead of hanging the suite**. Each mutant is killed by its own test and only its own.

**What could not be settled:** the exact 13 mutant IDs are not recoverable — the sweep state lived in
`/tmp` and did not survive the 2026-08-14 reboot. What is settled is the *mechanism* and the decision
rule, which is what the remaining IDs would have been judged by anyway. A re-sweep can now classify them
by inspection: name the sibling condition, ask whether it holds at shutdown.

## 3-RESULT · `reconnect / bonding` — DECLINED 2026-08-15, on evidence

§3 made the take/decline turn on whether the incident recurs. The box journal, re-read 2026-08-15:
**3 `re-pair` lines, all on 2026-07-30** — the tail of the 2026-07-29 episode itself — and **0**
escalations to the two-strike `stale_bond_hits` rule or a "could not re-establish" in the 16 days since.

⚠️ **The weakness is stated with the finding.** Sixteen quiet days is not strong evidence about a rare
failure, and the recovery path shipped *because* of that incident — so the quiet may be the fix working
rather than the failure being rare, which cuts toward the family mattering. The remaining input is
priority against the roadmap, which is an owner call. So this is declined **reversibly and
conditionally**, with the trigger written down: **a second stale-bond incident reopens it.**

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

* [x] **§5 measured 2026-08-15** — and the hypothesis was refuted: the answer is per-SITE, not
  per-class, and the patched sleep is not the cause. Nothing was written until the measurement was
  done; then two tests were, because the mechanism made them cheap. See §5-RESULT.
* [x] **§3 DECLINED 2026-08-15 in writing**, on journal evidence, reversibly — a second incident reopens it. See §3-RESULT.
* [x] **§4's rule is in `MUTATION-AUDIT-RUNBOOK` §7**, beside the ceiling rule — with the boundary it
  needs: it governs TUNED constants, not all constants. A number fixed by a wire format, a vendor spec
  or a physical unit is not tuning and stays pinned.
* [x] **The remaining families are marked DECLINED in `CAPTURE-HOST-MUTATION-FLEET` §7.8**, with the
  per-family reason in that file rather than only by reference, so `run_polar` cannot be re-opened as
  if it were untouched.
