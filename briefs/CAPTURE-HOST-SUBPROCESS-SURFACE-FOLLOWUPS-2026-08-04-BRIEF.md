<!--
  CAPTURE-HOST-SUBPROCESS-SURFACE-FOLLOWUPS-2026-08-04-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-08-26 (**two of three §8 items DONE 2026-08-04** — the runbook transfers landed and §5's hook is declined in favour of a tested aggregate gate, `capture-host/check.sh`. The third, §6's 21-mutant `harvest` cluster, is deliberately LEFT with the reason recorded: it is a fresh campaign, not this one's residue) ⚠️ **Flipped to DONE 2026-08-26.** `PROPOSED` means *unstarted*, and two of three items were executed on the day this was written — the label contradicted its own parenthesis for three weeks. It is DONE rather than IN-PROGRESS because the third item is not owed HERE: §8 records it as *"a fresh campaign, not residue of this one"* that *"deserves its own brief"*, which is the explicit park reason this repo's Done-when standard accepts (cf. `MULTI-SENSOR-DERIVATIONS-FOLLOWUPS`: *"each item is executed or carries an explicit park reason"*). Whoever picks up the 21 `harvest` mutants: §7 records the equivalents so they are not re-derived, and §6 names `pull_session` at 68.9 % as the larger target. · **Created:** 2026-08-04

# What executing the subprocess-surface brief turned up

Follow-up to `CAPTURE-HOST-SUBPROCESS-SURFACE-2026-08-04-BRIEF.md`, all four steps of which are DONE
(PRs #858, #873, #880). It killed **148** mutants against the 77 it scoped, and the campaign as a whole
**209** across eight PRs with zero regressions (see §6 — the count is `total − survived − timeout`, not
a survivor-set diff, which undercounts).

**Everything below is about the METHOD, not the code.** Nothing found a bug in `capture-host`. Every
serious problem was in the measuring instrument, and each one produced a confident wrong answer that
looked exactly like a correct one.

## 1 · The bet held, and the reason is one design choice

One recording double per call site unlocked whole clusters: **29 mutants from 12 tests** on `_sh`,
**54 from 27** on the async side — against 10 from 5 tests on a pure function. The leverage did not
come from the double existing. It came from **requiring the keyword arguments production passes**,
with no defaults:

```python
def __call__(self, argv=None, *, capture_output, text, timeout, **rest):   # no defaults, deliberately
```

The real `subprocess.run` defaults all three, and `create_subprocess_exec` defaults `stdout`/`stderr`
to *inherit*. So a dropped argument silently changes what the daemon does — uncaptured output, bytes
instead of `str`, no deadline, a child writing to the daemon's own stderr — while **every assertion
about the return value still passes**, because `""` and `None` both read as nothing useful. Four
mutants across the two doubles are visible ONLY because the double refuses the call outright.

**Carry this to the next double.** A double that mirrors the real signature, defaults included, cannot
see the class of change that matters most here.

## 2 · Runbook §1 needs a SEVENTH entry: a non-unique anchor

`s.replace(old, new, 1)` in an apply/revert loop mutates the FIRST match. `"-o", "BatchMode=yes",`
appears in both `rsync_argv` and `test_target`, so three mutants read as *survived* while the control
was measuring a function the tests never claimed to cover.

```python
assert s.count(anchor) == 1, "ANCHOR NOT UNIQUE (%d matches)" % s.count(anchor)
```

Once unique, two of those three were **real gaps**: every test configured `port` explicitly so
`get("port", 22)` was never exercised, and nothing observed the `rsync --version` probe's own 5 s bound
— invisible through `create_subprocess_exec` because the deadline is applied by
`proc_util.communicate`, so it must be watched at the `_run` boundary. A wrong instrument had been
hiding two genuine findings behind a wrong verdict.

## 3 · A slow test spends OTHER mutants' budget

One test patched `time.sleep` to a no-op and left `time.monotonic` real, so it burned the full 5 s
association floor: **5.18 s of the file's 5.22 s**. A mutation run pays that per mutant, and it pushed
three `wifi_up` mutants from **KILLED to TIMEOUT** — coverage lost in a function that was not being
touched, reported as neither pass nor fail. A synthetic clock took the file to **0.04 s** and all three
came back killed.

So: test runtime is not a neutral cost in a mutation-audited suite. It is drawn from the budget that
decides whether unrelated mutants get a verdict at all. Profile a new test file with `--durations`
before landing it; anything spinning a real wall-clock wait wants a fake clock.

## 4 · Widen the in-flight rule

The runbook says *do not edit the source while a mutation run is in flight*. That is too narrow. The
same day, the coverage gate was run in a worktree while the negative control was rewriting the module
under it, and the gate's 100 % was meaningless. The rule is:

> **Nothing that READS the tree may overlap anything that WRITES it.**

A cheap pre-flight — count live `pytest`/`mutate.py` processes and `git status` the module — costs one
command. Note the check cannot use a bare `pgrep`/`grep` for its own pattern: **the checking command's
own cmdline matches**, which is the same self-match that left waiters spinning for 10 h 45 m.

## 5 · §7's "read BOTH gates" failed twice — make it a check

`pytest --cov` printing `100%` and `ruff` failing on the next line happened in **#852 and again in
#880**, same defect (an unused import), same position. The brief already said to read both. A note is
weaker than a check.

**Proposal:** a `pre-commit` hook in `capture-host/` running `ruff check .` only. Seconds, no network,
catches exactly this. **⚠️ Check it against a real workflow first** — the last hook proposed here
(`CLAUDE.md` §2b's outcome guard) would have blocked every release, and that was found only by testing
it against `tools/release.mjs`.

## 6 · The measured result, and where the residue is

Totals are `mutmut`'s own, from the 2026-08-02 audit's `*.stats.json` (a module's total moves only when
its SOURCE does, and none of these changed). Killed counts are `total − survived − timeout`, measured
2026-08-04.

| file | total | killed before | killed after | Δ | before % | **after %** | PRs |
|---|---:|---:|---:|---:|---:|---:|---|
| `pull_session.py` | 466 | 288 | 321 | +33 | 61.8 % | **68.9 %** | #823 |
| `storage_targets.py` | 1073 | 871 | 935 | +64 | 81.2 % | **87.1 %** | #828 · #880 |
| `cpap_harvest.py` | 1231 | 946 | 1054 | +108 | 76.8 % | **85.6 %** | #852 · #858 · #873 |
| **subtotal** | **2770** | **2105** | **2310** | **+205** | **76.0 %** | **83.4 %** | |

Plus **4** in `capture.py` (`run_polar` worn-since, #805), verified by negative control only — no full
by-ID run was made on that module, so it carries no rate here. **Campaign total: 209.**

⚠️ **A by-ID survivor-set diff UNDERCOUNTS kills, and this brief's own draft said 204.** The comparison
that catches regressions — `comm` over the survivor sets, "does anything survive now that did not
before?" — cannot see a **timeout resolving to killed**, because a timeout was never in the survivor
set. `cpap_harvest` had 5 of those when §3's slow test was fixed. Both numbers are needed and they
answer different questions: the set diff for regressions, `total − survived − timeout` for the rate.
The runbook currently says only to watch the timeout count for contention.

**Where the residue is:**

| module | survivors left | what they are |
|---|---|---|
| `cpap_harvest` | 177 | ~122 log/error prose; `harvest` 21 logic |
| `storage_targets` | 138 | ~130 prose; `mount_unit` 7, `rsync_argv` 3, small tails |
| `pull_session` | 138 | concentrated in `_pull_once` — see below |

`storage_targets` (87.1 %) and `cpap_harvest` (85.6 %) are at their ceilings: the parent brief measured
the prose-and-equivalent fraction at 89–94 %, and both residues are now overwhelmingly log strings.

**`pull_session` at 68.9 % is the outlier and is NOT at its ceiling.** Its remainder sits in
`_pull_once`, which is BLE-shaped rather than subprocess-shaped, so it needs a third fixture family —
a different unit of work from the one this brief closed, and the obvious next campaign if there is one.

`harvest` (21) is the only cluster of size left and is the top-level driver — it orchestrates
`reachable` → `_wpa_up` → `EzShare` → `_wpa_down`, all of which are now observable, so it is reachable
work rather than a fixture problem.

**Do NOT chase the prose.** Per the parent brief's §8, pinning log text turns the suite into a
change-detector and reds the build on every message edit. Both modules are at their useful ceiling.

## 7 · Equivalents found, so nobody re-derives them

Each established by SEARCHING for a distinguishing input, not by argument:

* `reachable`: `method="GET"` / `method=None` / omitted are **byte-identical requests** — urllib
  defaults a data-less `Request` to GET. And `getattr(r, "status", 200)`'s default is only reached when
  `.status` is absent, so any value inside `[200, 400)` is indistinguishable (`201` is; `None` and
  dropping it fall outside, and both die).
* `cpap_harvest`: the size window's high bound (`<= hi` → `< hi`) admits no integer byte count because
  of the deliberate `1e-6` epsilon; the `B`-branch `/1024` → `/1025` is swallowed by the
  `max(…, 1e-3)` floor; `reap_stale_part`'s `and` → `or` is absorbed by `except OSError`, identical in
  return value AND file state across all four reachable cases.
* `pull_session`: two `continue` → `break` in the id guards are unreachable, because `parse_file_list`
  filters to 14-digit numeric and the only path that reaches them yields a one-element list, where
  `continue` IS `break`.

## 8 · Done when

* [x] **§2 and §3 are in the runbook, and §4 replaced the narrower wording — DONE 2026-08-04.**
  `MUTATION-AUDIT-RUNBOOK-2026-08-03` §1 is now *"**Seven** ways a run fails while looking fine"*: the
  non-unique-anchor row is in the table and the prose block below it carries the `s.count(anchor) == 1`
  assertion, explicitly noting that `>= 1` is **not** the check because it passes on exactly the case
  that breaks. §3's cost lesson is in runbook §4 beside the compile-once paragraph. The in-flight rule
  is widened in place to **"nothing that READS the tree may overlap anything that WRITES it"**, keeping
  the self-match warning about `pgrep`.
* [x] **§5 — the pre-commit hook is DECLINED; an aggregate gate is implemented instead. DONE 2026-08-04.**
  `capture-host/check.sh` runs ruff · shellcheck · pytest, **continues after a failure**, and computes
  its verdict from the collected exit codes. Documented in `capture-host/README.md` as the entry point.

  *Why not the hook §5 proposed:* a hook must be **installed**, and `core.hooksPath` is not set in this
  repo while several agent sessions work the tree — so the common state is a hook that exists in-repo
  and runs for nobody, which is a gate that does not gate rather than a mitigation of one. It also fires
  on deliberate WIP commits. §5's own warning applies directly: the last hook proposed there
  (`CLAUDE.md` §2b's outcome guard) would have blocked every release, found only by testing it against
  a real workflow. The JS side already solved this exact problem with an aggregate (`npm run check` —
  *"the only invocation that cannot silently omit a builder"*), so this is that, for capture-host.

  Verified by re-applying the defect — 5 mutants, all killed, including **`set -e`** (which would abort
  at the first failing gate and silently undo the entire point) and a verdict that ignores the collected
  codes. `check.sh` is itself owned by `tests/test_check_script.py` and listed in the shell-surface
  inventory; an ungated gate would have been the joke.
* [ ] **§6's `harvest` cluster (21 logic mutants) — LEFT, deliberately, and this is the note.**
  Not declined on cost: §6 states it is *"reachable work rather than a fixture problem"* now that
  `reachable` → `_wpa_up` → `EzShare` → `_wpa_down` are all observable. It is left because it is a
  **fresh campaign**, not residue of this one — the brief it follows is closed, its own §6 marks
  `cpap_harvest` at 85.6 % and *at its ceiling for prose*, and picking up 21 orchestration mutants is a
  scoped piece of work that deserves its own brief rather than being tacked onto a method write-up.
  `pull_session` at 68.9 % is called out there as the larger and more valuable target of the two.
  **Whoever takes either: read §7 first** — the equivalents are recorded precisely so they are not
  re-derived.
