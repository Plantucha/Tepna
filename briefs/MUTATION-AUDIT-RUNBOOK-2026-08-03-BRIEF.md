<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** REFERENCE (living — update when the tooling changes) · **last-verified:** 2026-08-18

# Running a mutation audit — the runbook

The findings live in `audits/MUTATION-AUDIT-FINDINGS-2026-08-02.md`. **This is the procedure**, written
after five modules and roughly twenty measured runs, and it exists because most of that time went into
failure modes that do not look like failures. Read §1 before your first run.

---

## 1 · Seven ways a run fails while looking fine

None of these prints anything resembling a test failure. Each cost an hour before it was recognised.

| symptom | actual cause | tell |
|---|---|---|
| every mutant `not checked` | **you read the results mid-run** | mutmut only commits at the end; there is no live progress via `mutate.py` |
| every mutant `not checked` | a test failed inside the `mutants/` copy | `mutmut run` prints `Running clean tests … done`; if it does not, the baseline is red |
| `rc: -15`, `timed_out: false` | the run was **signal-killed** | check `rc`, never `timed_out` alone |
| `failed to collect stats` | a test **scans module source** | see §5 — gate-backed since 2026-08-03 |
| **a rate of 100 %** | `mutmut results` returned EMPTY and something divided by it | `rc != 0`; see below |
| **`rc` absent from the record** | the printed JSON was truncated | fixed 2026-08-03 — verdict fields now print first |
| a mutant you reverted **still behaves as mutated** | **stale `.pyc`** — the source is clean, the CODE OBJECT is not | `git status` clean, `inspect.getsource` clean, behaviour wrong; see below |
| results that do not match the committed source | the source was **edited while the run was copying** | compare the run's start time against the file's mtime |
| three mutants `survived` in a function the tests never touch | the apply/revert loop's **anchor was not unique** — `str.replace(old,new,1)` mutated the FIRST match | `s.count(anchor)` > 1 |

**⚠️ STALE BYTECODE DEFEATS THE NEGATIVE CONTROL ITSELF — clear `__pycache__` before EVERY run.**
Measured 2026-08-04 on `cpap_harvest`. The repo lives on a volume with coarse mtime granularity, so a
mutate → test → restore cycle completing inside one timestamp bucket leaves Python's `(mtime, size)`
validity check satisfied and the **mutant's `.pyc` is reused against restored source**. The two mutants
here differed only in a digit (`want <= 0` → `want <= 1`), so the size matched too.

**⚠️ A NON-UNIQUE ANCHOR MEASURES THE WRONG FUNCTION, AND REPORTS IT AS A SURVIVOR.**
`s.replace(old, new, 1)` mutates the first match, so an anchor appearing twice silently relocates the
mutation. Measured 2026-08-04 on `storage_targets`: `"-o", "BatchMode=yes",` occurs in BOTH `rsync_argv`
and `test_target`, so three mutants intended for one landed in the other and read as **survived** while
the control was scoring a function the tests never claimed to cover. Assert uniqueness at apply time:

```python
assert s.count(anchor) == 1, "ANCHOR NOT UNIQUE (%d matches)" % s.count(anchor)
```

Note `>= 1` is NOT the check — it passes on exactly the case that breaks. Once made unique, two of
those three turned out to be **real gaps**: every test set `port` explicitly so `get("port", 22)` was
never exercised, and nothing observed the `rsync --version` probe's own 5 s bound (invisible through
`create_subprocess_exec`, because the deadline is applied by `proc_util.communicate` — it has to be
watched at the `_run` boundary). A wrong instrument was hiding two genuine findings behind a wrong
verdict, which is the same shape as every other row in this table.

What makes it the worst failure mode in this file: **every surface you would check to diagnose it reads
clean.** `git status` shows nothing. `git diff` shows nothing. `inspect.getsource` prints the correct
body — it re-reads the FILE by line number, not the code object. The only tell is that a hand-trace of
the function disagrees with what the function returns.

It corrupts the audit in BOTH directions: two killable mutants read as survivors (and would have been
filed as findings, or "fixed" with tests that were already correct), and any mutant that read as killed
could equally have been killed by a stale cache rather than by the test. **A negative-control matrix run
without clearing bytecode is not evidence.** Put the clear inside the loop, before each pytest:

```sh
find . -name __pycache__ -type d -prune -exec rm -rf {} + 2>/dev/null
```

`mutmut` itself is NOT exposed to this — mutmut 3 keeps every mutant in one inline file and selects at
runtime by env var, so the module source never changes between mutants and the cache stays valid. The
exposure is exactly the hand-rolled apply/revert loop this runbook tells you to write.

**⚠️ NOTHING THAT *READS* THE TREE MAY OVERLAP ANYTHING THAT *WRITES* IT.**
*(Widened 2026-08-04 from the narrower "do not edit the source while a run is in flight": the same
day, the coverage gate was run in a worktree while the negative control was rewriting the module
underneath it, and the gate's 100 % was meaningless. Reads are victims too, not just writers.)*
A pre-flight costs one command — count live `pytest`/`mutate.py` processes and `git status` the
module. ⚠️ That check cannot use a bare `pgrep`/`grep` for its own pattern: **the checking command's
own cmdline matches**, the same self-match that left waiters spinning for 10 h 45 m (`CLAUDE.md` §4).

 Also 2026-08-04, same module: a confirmation run
started at 05:33:39 and the negative-control cycles rewrote `cpap_harvest.py` at 05:37:15, underneath
it. Whatever it copied was a moving target, so its numbers describe no particular version of the code.
Kill such a run rather than waiting it out — a 26-minute result you cannot attribute is worth less than
starting again. Note this makes the two hazards compound: the apply/revert loop that needs the cache
clear is the same loop that must not overlap a run.

**The 100 % case is the dangerous one and it was self-inflicted.** On 2026-08-03 the scratch-reuse
refreshed only the test files NAMED IN THE SELECTION; `tests/_srcscan.py` is a helper, never named, so a
scratch predating it kept a stale `tests/` and every run died on `ModuleNotFoundError`. mutmut reported
`Failed to collect list of tests`, `mutmut results` returned an empty list, and a rate computed over it
read **100 % killed** — the precise failure `tools/mutate.py`'s header warns about. Reuse now refreshes
the whole `tests/` tree, because any new conftest, fixture module or helper would have done the same.

**So never compute a rate without both guards:**

```sh
[ "$(grep -o '"rc": [-0-9]*' run.log | head -1 | awk '{print $2}')" = "0" ] || exit 1
[ "$(grep -c 'not checked' results.txt)" -eq 0 ] || exit 1
```

A survivor count of ZERO on a module that had hundreds is not a triumph; it is this bug.

**Waiting correctly.** Do not sleep a guessed interval, and do not `pkill -f` a pattern that appears in
your own command line — that kills your shell (exit 144; it happened three times). Wait on the process:

```sh
until ! (ps -eo pid=,comm= | awk '$2 ~ /^python/ {print $1}' \
         | while read p; do tr '\0' ' ' < /proc/$p/cmdline | grep -q 'mutate.py <mod>' && echo x; done \
         | grep -q x); do sleep 20; done
```

---

## 2 · The procedure

```sh
cd capture-host
.venv/bin/python tools/mutate.py <module> --estimate     # price it first
.venv/bin/python tools/mutate.py <module>                # measure
```

Then, and this is the whole method:

1. **Re-measure before triaging anything.** A survivor list is a measurement of a moment. Lists are not
   committed on purpose. `polar_psftp`'s audit row said 69 % / 318 survivors; the truth on the day was
   75 % / 280, because a PR had landed in between. **Mutant IDs are per-function and positional**, so an
   ID in a function that PR touched still *resolves* — to a different mutation. Stale, silently.
2. **Triage before writing anything.** Dismiss on sight: log/error prose, unhittable float boundaries,
   equivalent mutants. **Predict the equivalents first**, then confirm they still survive — that is the
   correct outcome, not a failure.
3. **Write the test, then re-measure and confirm the specific mutant flipped BY ID.** A total that moved
   proves nothing about the mutant you aimed at.
4. **Only inspect IDs that appear in the survivors file.** Guessing an ID and reading its diff is how a
   killed mutant gets filed as a finding.

**⚠️ CHECK `scratch_id` BEFORE YOU DIFF.** Mutant IDs are numbered positionally per function, so
`x_f__mutmut_34` in one generation and another are the same NAME and not necessarily the same MUTATION.
Diffing survivor sets across generations fabricates deltas: on 2026-08-03 that reported **14 regressions
in `run_polar` that did not exist** — the baseline scratch had been deleted by this tool's own pruning
and the comparison ran against a different generation. Every record now carries `scratch_id` and
`mutant_generation` (the module's source hash), and a run that pruned an older scratch prints a
`WARNING`. **A before/after pair is only valid when both `mutant_generation` values match.**

**Diff the survivor sets, not the counts.** `comm` needs `LC_ALL=C`:

```sh
grep -oP '<mod>\.\S+(?=: survived)' before.txt | LC_ALL=C sort > b.txt   # same for after
LC_ALL=C comm -23 b.txt a.txt | wc -l      # killed by your pass
LC_ALL=C comm -13 b.txt a.txt              # NEW survivors — must be empty, investigate if not
```

A "new survivor" is usually a **timeout**, not a regression: mutmut's per-mutant budget derives from the
baseline clean run and does **not** grow with the test selection, so adding tests to a region can push
borderline mutants from `killed` to `timeout`. Read the survivor/timeout split separately.

**⚠️ AND THE SET DIFF UNDERCOUNTS KILLS — it cannot be the rate.** "Diff the sets, not the counts" is
right for **regressions** and wrong for the **rate**, and the two questions need different arithmetic:

| question | how |
|---|---|
| did anything break? | `comm` over the survivor sets — a NEW survivor is a regression |
| how many did I kill? | **`total − survived − timeout`**, from mutmut's own `*.stats.json` |

The set diff **structurally cannot see a timeout resolving to killed**, because a timeout was never in
the survivor set to begin with. So every mutant rescued by making a slow test fast is invisible to it.
Measured 2026-08-04: `cpap_harvest` had **5** of those the moment a real-wall-clock test was given a
synthetic clock, and `CAPTURE-HOST-SUBPROCESS-SURFACE-FOLLOWUPS`'s own draft reported the campaign as
**204** kills before the arithmetic was corrected to **209**. A brief written by someone following this
runbook got its headline number wrong by using the diff for both.

Both numbers, every time. They are not two views of one quantity.

---

## 3 · Reading a giant mutant file

mutmut 3 writes **one** module holding every mutant. For `webmon` that is 113 MB / 1.9 M lines; for
`capture` 100 MB. **`ast.parse` does not finish.** Diff by scanning for `def x_<fn>__mutmut_N(` headers
and slicing raw source — linear, about one second. `tools/mutate_pure.py`'s `harvest()` is that scan;
lift it.

---

## 4 · Cost, and what actually drives it

Every module is heavy for a **different** reason. Measure where the per-mutant second goes before
optimising — skipping that step cost an hour on `capture.py`.

| module | dominant cost | measured |
|---|---|---|
| `capture.py` | **compile**, once per run — a 567-line flat `run_polar` replicated 1 241× | cold import **429 s**, warm **0.4 s** |
| `webmon.py` | **compile ~46 %, then test time** — 23 files, aiohttp servers per case | cold import **26 min**, warm **0.5 s**; 0.79 s/mutant after |
| `clock.js` | **group selection** — 41 groups, loaded by everything | **7 m 49 s** per mutant |

⚠️ **The compile is paid ONCE PER RUN, not per mutant** — mutmut imports the module in the parent and
`fork()`s children that inherit it. That is why webmon averaged 1.5 s/mutant while its module took 26
minutes to import: 1 578 s of its 3 432 s run was the single cold compile. Do **not** conclude from a
low per-mutant average that a module is compile-free; compute `total − mutants × per_mutant` instead.

**⚠️ A SLOW TEST SPENDS OTHER MUTANTS' BUDGET — test runtime is not a neutral cost here.**
Measured 2026-08-04: one test patched `time.sleep` to a no-op but left `time.monotonic` real, so it sat
out the full 5 s association floor — **5.18 s of the file's 5.22 s**. A mutation run pays that *per
mutant*, and it pushed three `wifi_up` mutants from **KILLED to TIMEOUT**: coverage lost in a function
that test was not even touching, reported as neither pass nor fail. A synthetic clock took the file to
**0.04 s** and all three came back killed.

So a wall-clock wait anywhere in the suite is drawn from the budget deciding whether *unrelated* mutants
get a verdict at all. Profile a new test file with `--durations` before landing it; anything that spins
a real clock wants a fake one.
With the cache warm, webmon's run should be **~31 min rather than ~57**.

Two fixes are in `tools/mutate.py` and need no action; they are recorded so nobody reverts them:

* **Bytecode cache.** `PYTHONDONTWRITEBYTECODE=1` was set, and mutmut starts a fresh process per mutant
  — so every one recompiled 1.9 M lines. Cold import 429 s, with a `.pyc` 0.4 s; 7 197 × 429 s is 36
  days. The scratch is a throwaway `/tmp` copy, so the flag protected nothing.
* **Scratch reuse.** The generated file is a pure function of the **mutated module** (tests are copied,
  never mutated), so regenerating on a *test-only* edit rebuilt a byte-identical 100 MB file and threw
  the warm cache away. Scratches are keyed on the module's hash, reused, and pruned — `/tmp` is tmpfs
  here, and 153 orphans had accumulated to 2.6 GB. `--no-reuse` forces a rebuild; `reused_scratch`
  appears in the record so a reuse is never mistaken for a fresh generation.

**A `capture.py` iteration went from 22 min to 18 s** — but read that number correctly. **mutmut CACHES
per-mutant verdicts between runs** (*"cached runs keep the previous baseline"*), resetting only the ones
a code or test change could have invalidated. So a re-run on a reused scratch is **INCREMENTAL**: it
re-tests what your edit touched and keeps the rest. That is correct and is what makes iteration cheap —
but it means:

* an 18 s re-run is **not** a full measurement, and quoting it as one overstates the tooling;
* the **first** measurement of a module still costs full price (webmon ~57 min, of which 26 min was the
  cold compile before the bytecode fix);
* to force a genuine full re-measure — which you want before publishing a module's kill rate — use
  `--no-reuse`, which rebuilds the scratch and discards every cached verdict.

The warm/cold split still applies on top: `/tmp` is tmpfs, so a reboot clears every scratch and the next
run pays the cold compile once.

---

## 5 · Never read module source raw from a test

A test that scans a mutatable module's source sees **every mutant at once** and fails on the baseline,
which mutmut reports as `failed to collect stats` — the whole module unmeasurable, and it reads like a
broken environment. **`capture.py` had twelve such scans**; that is most of why the audit recorded it at
1 % measured for so long.

```python
from tests._srcscan import module_source
src = module_source("capture.py")      # ordinary read on real source, skips on a generated file
```

Which shapes break: `assert X not in src` (mutmut *generates* the forbidden string) · `len(m) == 1`
(664 copies) · `src.split(MARKER)[1]` (splits at the first *mutant's* copy). Only `assert X in src` is
tolerant. Gate-backed by `tests/test_mutation_hygiene.py`.

Do **not** reach for `tools/mutate.py`'s `SOURCE_SCANNING_TESTS` instead: it excludes a whole **file**,
including the real unit tests beside the scan. For `test_oxyii_rtc.py` that is `oxyii_rtc_due`'s only
coverage, whose 10 mutants would then be reported as fake survivors. Excluding a file to make a
measurement possible, at the cost of making it wrong, is not a fix.

---

## 6 · Picking a subsystem

`--only` filters **after** generation, so scoping does not reduce generation cost — it reduces test
time. Pick by *shape*, not size:

* **Pure predicates first.** `capture.py`'s 16 decision predicates were 230 of 7 197 mutants and the
  highest value per hour: each returns a go/no-go where a wrong answer is silent. 83 % → 91 %.
* **A giant function is not a unit of work.** `webmon`'s `make_app` holds 386 of 395 survivors; the unit
  is a *route*. `capture`'s `run_polar` is 1 241 mutants and needs its own approach — its tests are
  async runner tests with heavy fixtures, not pure calls.
* **`tools/mutate_pure.py`** is a fast path for pure functions only (235 mutants/s). It runs
  **zero-fixture tests only**, so its survivor set is a *superset* of the truth — false alarms, never
  blind spots. A triage accelerator, not a measurement of record. `--self-check <mutmut-dump>` exits 1
  on any disagreement. Do not extend it by synthesising fixtures: that was tried and reverted, because a
  test declaring only `monkeypatch` can still depend on **autouse** conftest fixtures.

---

## 7 · What "done" looks like

**Not 100 %.** Each module has a ceiling set by its prose-and-equivalent fraction. Measured here:
`polar_psftp` 94 %, `capture` predicates 91 %, `writers` 90 %, `webmon` 89 % — and the capture row is
*at* its ceiling, with all 21 remaining survivors accounted for as prose (16) or provably equivalent (5).
Another pass there kills nothing.

Equivalent mutants are **impossible**, not hard: `grace >= 0` vs `> 0` inside `bool(grace and …)` short-
circuits identically; `int(x, 16)` vs base 10 both fail a `== 0` check on a digit string; `newline=None`
on Linux *is* `\n`; HTTP header names are case-insensitive. Prose is killable but should not be —
pinning it turns the suite into a change-detector on wording, and *"a gate that reds on the untestable
is a gate someone switches off"*.

**Record the equivalents you confirmed**, so the next audit does not re-derive them.

**A mutant killable ONLY by asserting a TUNED constant is not the suite's to own** (added 2026-08-15
from `RUN-POLAR-MUTATION-STOP-HERE` §4 — the ceiling rule's sibling, and the one that decides what to
decline). Killing `backoff = min(backoff * 2, 60)` → `* 3`, or `60` → `61`, requires pinning the exact
sleep SEQUENCE a session produces. The constants here are tuned against a live radio — `CHARGE_RETRY_S`,
`_STALL_RECONNECT_S`, `_NOT_WORN_RECHECK_S`, `_REBOND_EVERY` have all moved in response to measurement —
and each move would then red a build in a file that has nothing to say about whether the new value is
better.

> **Pin the BEHAVIOUR the constant produces — backoff grows; it is capped; a stall reconnect is faster
> than an error backoff — and let the number move.**

Same trade this suite already makes for message wording (161 mutants → PROSE) and for `flush=`/`XX`
wrapping. It declined 29 `backoff / sleep cadence` mutants on `run_polar` and should decline their
equivalents everywhere.

⚠️ **It is a rule about TUNED constants, not about all constants.** A number fixed by a wire format, a
vendor spec or a physical unit is not tuning and must stay pinned — mutating a PMD opcode or an
`int(x, 16)` base is a real defect. The test is whether the value has *moved in response to
measurement*, not whether it is a literal.

**Do not wire a whole-tree kill-rate threshold into CI.** The gate that exists — `tools/mutate_diff.py`,
the `mutation-diff` job — is diff-scoped on purpose.

---

## 8 · The finding this method keeps producing

Across `polar_psftp`, `writers`, `webmon` and `capture`, one defect dominated: **a test double that
accepts an argument and discards it makes the code computing that argument unobservable, and coverage
still reads 100 % because the line ran.** `_bt_disconnect` had 22 survivors out of 22 mutants — the whole
function — under a test named for it whose fake was `async def fake(*a, **k)`.

Two corollaries, both learned the hard way:

* **A stub default must not mirror the production default.** `write_gatt_char(..., response=False)` in a
  fake cannot distinguish "passed correctly" from "not passed at all".
* **Assert the whole object.** `assert "OK" in out` survives `'XXOKXX'`; `"phantom BlueZ link" in
  reasons[0]` is blind to the device-name prefix; a row's cells 4-9 are free to be anything if the test
  reads 1-3 and the last.
