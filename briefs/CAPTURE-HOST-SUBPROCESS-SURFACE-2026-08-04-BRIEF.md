<!--
  CAPTURE-HOST-SUBPROCESS-SURFACE-2026-08-04-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED · **Created:** 2026-08-04

# The subprocess surface is where the surviving mutants live

The 2026-08-02 mutation audit's cheap half is done. Four work-units (PRs #805, #823, #828, #852) killed
**65 mutants**, all confirmed by ID, all in **pure functions** — argv parsing, scheduling boundaries,
size arithmetic. What is left is not more of the same. It is one shape, and it needs a fixture rather
than a boundary case.

## 1 · What remains, measured

Re-measured 2026-08-03/04, not read off the audit's stale lists (those drifted: `storage_targets` read
209 then and 202 on re-measure; `cpap_harvest` 282 then and 280).

| module | survivors | prose/log | logic | the logic clusters |
|---|---|---|---|---|
| `cpap_harvest` | 262 | 122 | 140 | `_wpa_up` 30 · `harvest` 21 · `_sh` 15 · `reachable` 11 |
| `storage_targets` | 192 | 130 | 62 | `test_target` 20 · `push_night` 13 · `dest_status` 10 · `mount_unit` 7 |

Roughly **55–65 % of every survivor list is log/error prose** and is dismissed on sight. Of the rest,
the four clusters above are **77 mutants in eight functions**, and every one of those functions reaches
the outside world through exactly two call sites:

* `cpap_harvest._sh` → synchronous `subprocess.run(cmd, capture_output=True, text=True, timeout=…)`
* `storage_targets._run` → `await asyncio.create_subprocess_exec(*argv, stdout=PIPE, stderr=STDOUT)`

That is the whole surface. It is small, and it is already faked in places.

## 2 · The pattern exists — it was never driven through the clusters

`tests/test_cpap_wifi_commands.py` already has the right shape, and it is worth copying rather than
reinventing. It records every call and then asserts the things a discarding double would hide:

```python
assert seen["argv"] == ["ip", "route", "show", "default"]
assert seen["kw"]["capture_output"] is True, "an uncaptured answer is no answer"
assert seen["kw"]["text"] is True, "the output is parsed as text, not bytes"
assert seen["kw"]["timeout"] == 10
```

Those three keyword assertions are the point. **This repo's recurring defect is a double that accepts
an argument and discards it**, which makes the code computing that argument unobservable while coverage
still reads 100 % because the line ran. PR #823 was one instance: `main()` handed seven arguments to
`pull()`, the test captured all seven and asserted two, and 33 mutants lived behind the five it threw
away. The same shape is available here for every `sudo -n`, every timeout, and every argv the harvest
builds.

`storage_targets._run` has **no** equivalent — its async call site is faked ad hoc where it is faked at
all. `tests/test_capture.py:171` and `test_coverage_small_modules.py:278` show the
`create_subprocess_exec` shape; neither is reusable.

## 3 · What the clusters actually guard

Not bookkeeping. Each of these functions is the failure path of something that has already gone wrong
in production:

* **`_wpa_up` (30)** — brings up `wpa_supplicant` against the card's AP, entirely under `sudo -n`.
  `reachable`'s docstring records the 2026-07-28 run that died at `sudo -n mkdir -p` with "interactive
  authentication is required" and skipped the day, with a night of therapy data one HTTP GET away.
* **`_sh` (15)** — the bounded runner. It **never raises**: `FileNotFoundError` → `(127, …)`,
  `TimeoutExpired` → its own code. A mutant in that mapping turns a missing binary into a silent
  success. Its `sudo -n` choice is deliberate — a daemon has nobody to answer a password prompt, so a
  missing sudoers rule must fail fast rather than hang to the deadline.
* **`reachable` (11)** — the probe that lets one build serve both deployments: if the card answers on
  the house network, the entire privileged branch is skipped. A mutant here re-enables privileged
  bring-up on a box that does not need it.
* **`test_target` / `push_night` / `dest_status` (43)** — the offload's own reachability and transfer.

## 4 · Plan

One work-unit per cluster, smallest first. Each is a PR.

1. **`_sh` (15)** — a recording `subprocess.run` fake as a shared fixture in `tests/conftest.py`,
   returning a caller-supplied `(rc, stdout, stderr)` and recording `argv` + every kwarg. Pin the
   `sudo -n` prefix, the timeout pass-through, and both exception mappings.
2. **`reachable` (11)** — fake at the HTTP layer, not the socket. Pin that it is ONE unretried GET and
   that a failure returns `False` rather than raising.
3. **`_wpa_up` (30)** — built on (1). Pin the command SEQUENCE and its order, as
   `test_the_teardown_runs_three_privileged_commands_in_order` already does for `_wpa_down`.
4. **`storage_targets._run` (43 across three functions)** — the async sibling fixture, then the three
   clusters.

## 5 · Method — non-negotiable, and two of these are new

Inherited from the campaign and from `MUTATION-AUDIT-RUNBOOK-2026-08-03`:

* **Triage before writing.** Dismiss prose on sight. **Predict equivalents, then confirm they still
  survive** — that is a correct outcome, not a shortfall. #852 predicted three and all three held.
* **Negative-control every test** by re-applying the mutant. #828 killed 7 of 8 on the first pass; the
  survivor was a `microsecond=0` whose anchor shifts by half a second while the test's input was ten
  seconds away. Reading the code would not have found that.
* **⚠️ Clear `__pycache__` inside the apply/revert loop.** New, and it corrupted a matrix in both
  directions before it was caught (runbook §1). On this volume a mutate→test→restore inside one mtime
  bucket reuses the *mutant's* bytecode against restored source, and `git status`, `git diff` and
  `inspect.getsource` all read clean.
* **⚠️ Never edit the source while a run is in flight.** Also new, also §1.
* **Confirm by ID, both directions, under `LC_ALL=C`** — newly killed AND nothing that survives now but
  did not before. A moved total proves nothing.
* Watch the **timeout count**: these modules time out 5 mutants at baseline. A change there means CPU
  contention, not a test.

## 6 · Non-goals

* **No whole-tree kill-rate threshold in CI.** `tools/mutate_diff.py` and the mutation-diff job are
  diff-scoped on purpose and stay that way.
* **No live hardware.** The suite is hermetic and that is a property worth protecting: a test that
  needs a radio cannot run in CI. The vigil box answers questions about *production configuration*
  (it runs `ftype: 0`, which is why #823 asserts a dead config knob rather than a device behaviour),
  never about assertions.
* **Not the prose.** ~120 survivors per module are log strings. Leave them.

## 7 · Done when

* Each of the four clusters has a PR; each states **survivors before → after**, the **IDs killed**, and
  the **equivalents predicted and confirmed still surviving**.
* Every new test negative-controlled, with the mutant named.
* `pytest -q --cov --cov-branch --cov-fail-under=100` green and `ruff check .` clean per PR — **read
  both**, not the coverage line alone (a leftover import failed ruff in #852 inside output whose
  coverage line said 100 %).
* A follow-up brief spawned per the lifecycle, or this one states that nothing surfaced.

## 8 · What this is not expected to produce

A number. The kill rate on these modules will stay well under 100 % because most of what remains is
prose, and driving it up would mean asserting log text — which pins wording rather than behaviour and
makes every future message edit a red build. The deliverable is **the eight functions above being
observable**, not a percentage.
