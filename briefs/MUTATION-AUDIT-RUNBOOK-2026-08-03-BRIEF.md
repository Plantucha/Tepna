<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** REFERENCE (living — update when the tooling changes) · **last-verified:** 2026-08-03

# Running a mutation audit — the runbook

The findings live in `audits/MUTATION-AUDIT-FINDINGS-2026-08-02.md`. **This is the procedure**, written
after five modules and roughly twenty measured runs, and it exists because most of that time went into
failure modes that do not look like failures. Read §1 before your first run.

---

## 1 · Four ways a run fails while looking fine

None of these prints anything resembling a test failure. Each cost an hour before it was recognised.

| symptom | actual cause | tell |
|---|---|---|
| every mutant `not checked` | **you read the results mid-run** | mutmut only commits at the end; there is no live progress via `mutate.py` |
| every mutant `not checked` | a test failed inside the `mutants/` copy | `mutmut run` prints `Running clean tests … done`; if it does not, the baseline is red |
| `rc: -15`, `timed_out: false` | the run was **signal-killed** | check `rc`, never `timed_out` alone |
| `failed to collect stats` | a test **scans module source** | see §5 — gate-backed since 2026-08-03 |

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

**Diff the survivor sets, not the counts.** `comm` needs `LC_ALL=C`:

```sh
grep -oP '<mod>\.\S+(?=: survived)' before.txt | LC_ALL=C sort > b.txt   # same for after
LC_ALL=C comm -23 b.txt a.txt | wc -l      # killed by your pass
LC_ALL=C comm -13 b.txt a.txt              # NEW survivors — must be empty, investigate if not
```

A "new survivor" is usually a **timeout**, not a regression: mutmut's per-mutant budget derives from the
baseline clean run and does **not** grow with the test selection, so adding tests to a region can push
borderline mutants from `killed` to `timeout`. Read the survivor/timeout split separately.

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

| module | dominant cost | per-mutant |
|---|---|---|
| `capture.py` | **compile** — one 567-line flat `run_polar` replicated 1 241× | 0.08 s (was 429 s) |
| `webmon.py` | **test time** — 11 files, aiohttp servers per case | ~1.5 s |
| `clock.js` | **group selection** — 41 groups, loaded by everything | **7 m 49 s** |

Two fixes are in `tools/mutate.py` and need no action; they are recorded so nobody reverts them:

* **Bytecode cache.** `PYTHONDONTWRITEBYTECODE=1` was set, and mutmut starts a fresh process per mutant
  — so every one recompiled 1.9 M lines. Cold import 429 s, with a `.pyc` 0.4 s; 7 197 × 429 s is 36
  days. The scratch is a throwaway `/tmp` copy, so the flag protected nothing.
* **Scratch reuse.** The generated file is a pure function of the **mutated module** (tests are copied,
  never mutated), so regenerating on a *test-only* edit rebuilt a byte-identical 100 MB file and threw
  the warm cache away. Scratches are keyed on the module's hash, reused, and pruned — `/tmp` is tmpfs
  here, and 153 orphans had accumulated to 2.6 GB. `--no-reuse` forces a rebuild; `reused_scratch`
  appears in the record so a reuse is never mistaken for a fresh generation.

**A `capture.py` iteration went from 22 min to 18 s.** The 18 s is a *warm* number: `/tmp` is tmpfs, so
a reboot clears every scratch and the next run pays the cold cost once.

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
