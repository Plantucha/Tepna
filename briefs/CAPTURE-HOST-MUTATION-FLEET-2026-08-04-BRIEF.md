<!--
  CAPTURE-HOST-MUTATION-FLEET-2026-08-04-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED · **Created:** 2026-08-04

# The whole capture-host mutation surface, ranked — and what actually predicts a cheap pass

Successor to `CAPTURE-HOST-SUBPROCESS-SURFACE-FOLLOWUPS-2026-08-04`, which closed one subsystem. This
one measures **all 19 modules that have a scratch** and answers the question that governed every
decision after it: *which pass is cheapest next.*

## 1 · The ranking

`tools/mutate_triage.py --rank`, 2026-08-04. Sorted by LARGEST REACHABLE CLUSTER, not by what is left.

| module | survivors | reachable | largest cluster | share |
|---|---:|---:|---|---:|
| `capture` | 622 | **502** | `run_polar`=502 | **100 %** |
| `webmon` | 223 | 97 | `make_app`=94 | 97 % |
| `timeline` | 115 | 82 | `build`=36 | 44 % |
| `nightqc` | 119 | 67 | `summarize`=32 | 48 % |
| `oxyii` | 80 | 65 | `parse_live`=11 | 17 % |
| `polar_pmd` | 58 | 55 | `decode_frame`=25 | 45 % |
| `bonding` | 73 | 55 | `scan`=17 | 31 % |
| `pull_session` | 104 | 49 | `_pull_once`=31 | 63 % |
| `storage_targets` | 138 | 43 | `test_target`=11 | 26 % |
| `telemetry` | 55 | 42 | `TelemetryBus.push`=11 | 26 % |
| `host_clock` | 97 | 41 | `read_state`=18 | 44 % |
| `clockcfg` | 88 | 37 | `status`=11 | 30 % |
| `nightarchive` | 16 | 16 | `uncovered_subtrees`=5 | 31 % |
| `link_rssi` | 43 | 14 | `_run`=4 | 29 % |
| `diskguard` | 15 | 14 | `disk_report`=9 | 64 % |
| `proc_util` | 2 | — | — | — |
| `viatom` | 1 | — | — | — |
| `settings_schema` | **0** | **0** | — | — |

**~1,150 reachable fleet-wide.** Not the 149 an earlier note implied — that figure covered only the
four modules then measured, and should not be quoted.

## 2 · What predicts cost: CONCENTRATION, not history and not count

Thirteen passes, 2026-08-04, every kill confirmed by ID:

```
_pull_once 34 · harvest 13 · _get 14 · link_guard 9 · diskguard 11 · alerts 10
bonding 15 · clockcfg 40 · bonding/scan 18 · viatom+settings_schema · proc_util 5 · link_rssi 1
```

After `34 → 13 → 14` on already-worked modules I recorded that returns had flattened to ~13/pass.
That was **wrong as a general claim**: never-measured modules then gave `9 → 11 → 10 → 15 → 40`.
`clockcfg` returned 40 from six tests because 27 sat in ONE function no test had driven.

The flattening was WITHIN a module. Across the fleet the predictor is the size of the largest cluster:

* **share ≥ 60 %** — one fixture takes most of it. `clockcfg` (40 from 6 tests), `_pull_once` (34).
* **share ≤ 30 %** — scattered; each mutant costs its own setup. `link_rssi` returned **1 mutant for
  3 tests**, the worst pass of the day, and its share is 29 %.

`concentration()` now computes this (`mutation_triage.py`, inside the coverage floor); `--rank` sorts
by it.

## 3 · The prize, and why it was mis-scoped before

**`capture.run_polar`: 502 reachable, 100 % concentration** — 44 % of the entire fleet remainder in one
function. Earlier sessions measured `capture.py` at 45 % and treated it as intractable *because of its
size* (3,600 lines, a 26-minute run, 109 test files). Concentration says the opposite: it is one
function, and one fixture family reaches all of it.

This is the single highest-value unit in `capture-host` and it has never been attempted. It needs its
own brief; `MUTATION-AUDIT-RUNBOOK §6` already says the honest unit of work for `capture.py` is one
SUBSYSTEM via `--only 'capture.x__run_polar__*'`.

## 4 · What to do, in order

1. **`capture.run_polar`** (502). Own brief. Use `--only` to scope the run.
2. **`webmon.make_app`** (94 @ 97 %). Known pathological to measure — a run once blew a 1-hour cap —
   so scope it with `--only` too rather than measuring the module.
3. **`timeline.build`** (36), **`nightqc.summarize`** (32), **`polar_pmd.decode_frame`** (25),
   **`host_clock.read_state`** (18) — mid-size, ~45 % share, one fixture each.
4. **Finish the closables**: `viatom` 1, `proc_util` 2, `diskguard` 14 @ 64 %.
5. **Do NOT** grind the ≤ 30 % tails (`oxyii` 17 %, `storage_targets` 26 %, `telemetry` 26 %,
   `link_rssi` 29 %) until the above are done. `link_rssi` is the measured proof of what that costs.

## 5 · The ceiling is not 100 %, and the difference is not effort

| module | ceiling | unobservable |
|---|---:|---:|
| `cpap_harvest` | 94.1 % | 73 |
| `storage_targets` | 91.4 % | 92 |
| `pull_session` | 89.1 % | 51 |

`flush=True/False/None` is identical to any assertion on captured output; mutmut's `"XX…XX"` wrapping
and case flips need exact-text assertions. Killing those pins WORDING, which reds the build on every
message edit. **The target is zero REACHABLE, not 100 %.** A brief or report quoting a kill-rate goal
without the ceiling beside it is quoting a number that may be unattainable — this is why
`--rank`/`ceiling()` refuse to print one alone.

## 6 · Method findings — every serious failure was in the INSTRUMENT

Not one of these was a bug in `capture-host`. Each produced a confident wrong answer:

* a **stale `.pyc`** ran a reverted mutant while `git status`, `git diff` and `inspect.getsource` all
  read clean — the negative control was corrupted in BOTH directions
* `replace(old, new, 1)` on an anchor matching **two** functions mutated the wrong one; three mutants
  read as survived, and two of those were REAL gaps the wrong instrument hid
* a **5.18 s** test spent the per-mutant budget and pushed three unrelated `wifi_up` mutants from
  KILLED to TIMEOUT
* a survivor-set diff **undercounts kills** — it cannot see a timeout resolving to killed (5 of them)
* a run truncated by a foreground timeout left `mutmut results` empty, which counted as a **perfect
  score**. Only the progress file saying `generating mutants` rather than `FINISHED` separated it from
  a real sweep.
* appending tests **shadowed an existing `_night` helper** and broke 30 passing tests in a file I was
  not otherwise touching

**Standing checks, all now cheap:** clear `__pycache__` inside any apply/revert loop · never let a
reader of the tree overlap a writer · assert the mutation anchor is unique · confirm the run said
`FINISHED` before believing a rate · profile a new test file with `--durations`.

## 7 · Open

* **The corpus.** `/EcgNightly` is not present locally (an unmounted `data` volume, `sdb1`, is the
  likely home) and does not exist on vigil, which has `/srv/tepna/captures` — 9.0 GB, 13 nights. The
  suite is hermetic BY DESIGN (`SUBPROCESS-SURFACE §6`) and should stay so, but real frames would
  legitimately inform **`oxyii.parse_live`** and **`polar_pmd.decode_frame`**: they would say which
  decode paths actually occur, rather than which ones can be imagined. Resolve the path before those
  two passes, not before the others.
* **`--rank` is silent** while it runs (a `mutmut show` per survivor, fleet-wide). Third instance of
  that defect in one day; the rule that would have caught all three is mechanical: anything looping
  over more than ~50 items gets a progress line before it ships.
* **The equivalence witness search is still unwired.** `EQUIVALENT?` has read 0 in every run while five
  equivalences were proved BY HAND today (two `continue`→`break`, three `n_samples` boundaries,
  `method=None`, the `getattr` default, `flush=`). `tools/mutate_pure.py` already searches for a
  distinguishing input; folding it into triage is what stops someone writing a test that cannot pass.

## 8 · Done when

* `capture.run_polar` has its own brief and a first pass.
* Every module in §4 items 1–4 has a PR stating survivors before → after, IDs killed, and equivalents
  predicted and confirmed still surviving.
* §7's three open items are each resolved or explicitly declined with a reason.
