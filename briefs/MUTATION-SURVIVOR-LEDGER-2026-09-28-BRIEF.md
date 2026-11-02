<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** IN-PROGRESS — 2026-11-01 · **Created:** 2026-09-28

# The mutation survivor ledger

## 1 · The problem, stated as a lifetime

A mutation survivor is reported **against a PR's diff** and is never raised again once that PR
merges. The diff scoping is correct and is not what is being changed here — `mutation.yml` says it
plainly (*"never judging code nobody touched"*), a full JS sweep is ~11,500 mutants ≈ 150 h, and
capture.py cannot be swept at all (the memory refusal added in #3185 says so with numbers). But the
gate is **advisory**, so a red does not hold a merge, and once the lines are on `main` nothing will
ever look at them again.

**A finding's whole lifetime is one PR.** Not deferred — lost.

### The worked example, verifiable today

`mutation (diff-scoped)` reported **14 survivors** on `loss_audit.py::_has_worn_evidence` for #3022.
#3022 merged with the check red. #3024 then killed **4** of them with assertions verified by
hand-applying each mutation, and left **10** unclassified. Those ten are, as of this brief:

- not in `capture-host/tools/mutate-equivalence.json` (`grep -c read_one` → 0,
  `grep -c _has_worn_evidence` → 0),
- not in any gate output, because `mutate_diff --base origin/main` on the follow-up correctly
  returns `NOT_APPLICABLE` — only test files changed,
- not in `briefs/RESIDUE.md` as individual findings; the row records that they exist, in prose, by
  mutmut id — and **a mutmut id is not a stable name** (`diff_key`'s own docstring: the index
  "shifts whenever anything earlier in the function changes").

So the only record of ten real, measured, unanswered findings is a sentence in a residue row keyed
on identifiers that have already stopped meaning what they meant.

### And they had already stopped — measured while writing this brief

The row lists the ten by mutmut id: **12, 15, 18, 37, 38, 42, 56, 57, 64, 65**. Re-running the
function locally on 2026-09-28 (`tools/mutate.py loss_audit.py --only
'loss_audit.x__has_worn_evidence__mutmut_*'`, 69.8 s, rc 0) reports **twelve**:

> **12, 15, 18, 21, 37, 38, 39, 42, 56, 57, 58, 65**

`21`, `39` and `58` are there and `64` is not. **By id there is no way to tell which of those moved
because the code changed and which because the numbering shifted** — and that is not a hypothetical
argument for a content key, it is what the only existing record of this finding has already done in
four days. Re-deriving the twelve cost one 70-second run; nothing short of that run could have
recovered them, because the CI log renders the mutant text lossily and the artifact it came from is
addressable only by a run id nothing on the merged commit points at.

The twelve are seeded into the ledger with their `diff_key` strings as the first real entries. Their
prose classifications in the residue row (both-falsy, locale-dependent, absorbed-by-`c.strip()`,
trailing-comment) are NOT carried over as `equivalent`: each still needs its probe run against
original and mutant before it can be entered as `no-distinguishing-input`, and importing an argument
nobody re-checked is how a ledger becomes a place findings go to look answered.

> ⚠️ **A premise in the hand-off, corrected.** This unit was described as using "the two orphans
> #3095 left behind" as the worked example. #3095 left **8** orphaned equivalence entries and **41**
> survivors, not two — and all 49 were drained in **#3136** (41 → 0 killed-or-classified, 8 → 0
> re-anchored-or-removed). There is nothing outstanding from #3095 to work from. The #3022/#3024 ten
> above are the live case, and they are the case the residue row was actually filed about.

### Measured 2026-10-20 — re-surveying two merged batches, and the three ways a survivor stops being one

Residue row `2026-10-12-the-api-lane-drain-batches-leave-mutation-survivors` recorded two CI survivor
sets by mutmut id, read out of the job logs: **63** for #3476 at `05f4731f2` and **12** for #3494 at
`b72f3f36d`. Both PRs merged on 2026-10-13, so the row is the only record. Re-measuring it on `main`
at `a9e028a83` took ten scoped `tools/mutate.py --only` sweeps under the fleet rig lock — 1540 s,
**645 mutants** over the ten functions that carried a survivor.

**The 75 recorded entries are 74 distinct diff keys.** `loss_audit.x_sample_object__mutmut_16` and
`__mutmut_17` delete different arguments of the same call and print the same line,
`_dt.datetime(2026, 1, 22, 0, 0)`. §2a-bis argues content alone loses a twin from the ingest side;
this is the same collision seen from the re-survey side, on the first set anyone re-measured.

**And an id drifts while its text holds.** `mutation_diff.x_result_inconsistency__mutmut_45` is
`__mutmut_50` today, same diff, same function, five positions along.

#### What a set difference would have claimed, and what the sweeps found

| | | share |
|---|---|---|
| **KILLED** — the mutant exists today and a test now sees it | **30** | 41 % |
| **ABSENT** — no mutant with that text is generated any more | **30** | 41 % |
| **STILL** — alive again today, and the gate requires it | **12** | 16 % |
| **EXCUSED** — a `mutate-equivalence.json` entry now covers it | **2** | 3 % |

A set difference over survivor lists reports *not a survivor today* and calls it a kill. That reads
**60** kills here, and 30 of those 60 are mutants no test ever saw. **Three different events make a
recorded survivor stop appearing, and only one of them is progress.**

#### ABSENT is not RELOCATED — a docstring moves the WORK, never the mutant identity

26 of the 30 absent keys (27 recorded entries; the `__mutmut_16`/`_17` pair shares one `diff_key`) are
`loss_audit.sample_object`, whose `t0 = _dt.datetime(2026, 1, 1, 22, 0, 0)` line no longer exists. It
was not deleted. #3667 split the fixture layout into `sample_night`, and its docstring says why:
*"twenty-seven mutations of this layout survived the mutation gate while `sample_object` was the only
way in"*.

**That docstring is a citation, and this section first published it as if it were a measurement.** The
sweep says otherwise. `--only 'loss_audit.x_sample_night__*'` (2026-10-20, 108 s wall) generates **81**
mutants, kills **79**, and leaves **2** survivors — both `encoding="utf-8"` → `"UTF-8"`, which
`string_only_verdict` rules out, so **0 are gate-required**. And **0 of the 27 recorded keys appear
among those 81.**

So the keys are genuinely ABSENT, not alive one scope away: the split rewrote the mutated TEXT, which
is exactly the condition under which a `diff_key` finding stops applying (§2a, below). A successor
function inherits the RESPONSIBILITY named in the docstring it carries. It does not inherit the
predecessor's mutants, and no docstring can say whether it is survivor-free.
Only the sweep can, and here it is — `sample_night` carries the layout today with zero required
survivors. The general limitation still holds — a function-scoped re-survey cannot see relocation — but
on this population relocation is not what happened.

The remaining four behave the same way: `proc_util.kill`'s `signalled_group` flag is gone from the
module (#3544) and `write_night`'s wrapped call was re-spelled, and in both cases the sweep over the
**whole** enclosing function reports zero required survivors, which is what settles those four.

#### The gate's own exclusions are part of a survivor's identity

Today's ten sweeps leave **31 raw survivors**. The gate would demand twelve of them:

| | |
|---|---|
| raw survivors | 31 |
| `mutation_diff.string_only_verdict` rules out as a string-literal mutation | −14 |
| `tools/mutate-equivalence.json` excuses | −5 |
| **gate-required** | **12** |

Every one of the twelve was already in the two recorded sets. **Nothing regressed, and no function
grew a required survivor the CI runs had not named.** Read the raw list as a backlog and you size 31
tests for twelve findings — the error this brief's §2f and the row `2026-10-13-eleven-mutants-survive-the-worn-verdict-and-the-process-kill` both record.

#### Who killed the thirty

Attribution here is by file history and by test name, not by bisection. #3667 is the answer for 26 of
them: it pins `journal_shape` (19), `read_journal_shape` (3) and `write_sidecar_note` (4), and its own
measurement reads *"436 killed / 113 survived becomes 507 killed / 18 survived"*. #3544's `test_proc_util.py`
work covers `_leads_own_group` (2), and one of `mutation_diff.py`'s seven later commits covers
`result_inconsistency` (1). The last kill is `LinkLogWriter.__init__`'s `_FlushHealth(None)`, where
neither the function nor `test_writers.py` changed — so a sibling module's test now reaches it, and
naming that test would cost a bisection this measurement did not buy.

#### What is still open

The twelve live in three functions. `telemetry.worn_verdict` holds five, which DRAFT #3748 addresses and
which row `2026-10-13-eleven-mutants-survive-the-worn-verdict-and-the-process-kill` already carries. The
other seven are one family: every keyword of an `open()` call in `writers.py` — `newline="\n"`,
`encoding="utf-8"` and `buffering=1 << 16` — on `write_sidecar_note` (2) and `LinkLogWriter.__init__`
(5). Row `2026-10-20-seven-open-keyword-mutants-survive-in-writers` carries them.

**For this brief the measurement is one more acceptance argument.** Every number above came out of a
1540 s mutation run plus a hand-written parse, because the record was a prose list of mutmut ids. An
entry keyed as §2a-bis specifies would have answered *killed*, *absent* or *still alive* for each of the
74 without running anything — note that *relocated* is not among them: the key orphans when the mutated
text changes, and only a sweep of the successor function can say whether the finding travelled.

## 2 · Design

One file, `mutation-survivors.json`, with a **`lane` field** — not two files. The mutant key is
lane-independent, and two files would make "what is unclassified right now" a join.

### 2a · The key is CONTENT, and that is the whole design

An entry is keyed on **module + function + the mutant's own `-`/`+` diff pair**, reusing
`mutation_diff.diff_key` verbatim so a survivor entry and an equivalence entry for the same mutant
carry the *same* string and can be cross-referenced by eye.

Three keys were considered and two rejected:

| candidate | why not |
|---|---|
| `__mutmut_N` | shifts when anything earlier in the function changes; keeps matching while pointing at a different mutation — the exact failure `diff_key` was written to prevent |
| `line + op + before` (`mutation-ai-probe.mjs::probeKey`) | **right for its job, wrong for this one.** That journal lives inside ONE sweep of ONE file version, where a line number is stable and cheap. A ledger entry must survive months of unrelated edits above it, and a line key would orphan every entry on the first insertion |
| **module + function + `diff_key`** | survives relocation within a file; matches the equivalence ledger; orphans only when the mutated TEXT changes, which is exactly when the finding genuinely no longer applies |

Note the residual honesty: an entry whose function is renamed *will* orphan, and it must be reported
as orphaned rather than silently dropped — the same rule `mutate_diff` already applies to orphaned
equivalence entries ("it excuses nothing until re-verified").

### 2a-bis · The key is CONTENT **plus POSITION**, and neither alone is enough

Content alone was the original design, and it lost findings. Two distinct survivors in the same
function whose mutation text is identical share `lane + module + function + diff_key`, so the second
was folded into the first and reported *"already open"* — as the same finding rather than a lost one.
Measured on `capture-host/loss_audit.py`: **8 of its 27 functions generate a duplicate `diff_key`**,
28 distinct colliding texts over **86 of 2141 mutants (4.0 %)**, and the recurring shape is
`- continue | + break`. Ingesting three real twins (`x_read_journal` 55/67/76) gave
`3 survivor(s): 1 new, 2 already open`.

Position alone is no better, and it fails the other way: a line index shifts whenever anything above
it inside the function changes, so a key carrying one orphans on the next unrelated edit — which is
exactly the instability that made `__mutmut_N` unusable as a name (§2a).

So the key is content **plus** an **occurrence ordinal**, and the ordinal rather than the raw line is
the deliberate part:

| | changes when | in the key? |
|---|---|---|
| `diff_key` (content) | the mutated text changes — i.e. when the finding genuinely no longer applies | **yes** |
| occurrence ordinal | a TWIN is added or removed — the one event that changes which occurrence is which | **yes** |
| `file_line` (position) | any edit above it in the function | **no** — recorded as a breadcrumb, because it is what a reader needs to FIND the thing |

Ordinal `0` contributes nothing to the key string, so every entry written before ordinals existed
keys identically and the ledger migrates without re-identifying a row — checked by `migrate`, which
refuses rather than assuming it.

**Where the position comes from.** mutmut discards it — `position.start.line` is computed in
`mutation/file_mutation.py` only to filter on pragmas and coverage, `mutmut-stats.json` carries no
line, and the mutant NUMBER is not a source-ordered substitute (measured: monotonic in **23 of 27**
functions). But the gate's artifact already diffs each mutant against its original, so the hunk
header carries it and `positionOfSurvivor` reads it there. Nothing is needed from mutmut.

### 2b · The entry

```json
{ "lane": "py", "module": "capture-host/loss_audit.py", "function": "_has_worn_evidence",
  "key": "- read_one = False | + read_one = None",
  "mutant": "<the mutant's diff text, verbatim>",
  "file_line": "loss_audit.py:214", "pr": 3022, "run_id": "…", "merge_sha": "…",
  "reported": "2026-09-22", "state": "open" }
```

`state` is `open` | `killed #N` | `equivalent` (the last carrying its probe, or pointing at the
equivalence-ledger entry that now holds it). `file_line` is **at report time** and is a breadcrumb,
never the identity.

### 2c · `ingest` refuses what it cannot attribute

Three rules, all of them refusals rather than defaults:

1. **No `--pr`, or a `--pr` that disagrees with the run's own PR → refuse.** An entry whose origin is
   unknown cannot be closed by anyone later, and a wrong PR number is worse than none.
2. **"No survivors" and "examined nothing" are different facts.** A `NOT_APPLICABLE` or `NOT_RUN`
   verdict is an ABSENT measurement and must not ingest as an empty survivor list — that would read
   as "this function is clean" (§∅, and §🧾's own distinction between the two statuses).
3. **A FAIL's survivor list is a LOWER BOUND unless every mutant reached a verdict.** The checkable
   tell is `decided < generated`; ingest records the shortfall on the batch rather than implying the
   list is complete.

### 2d · The ratchet, and what it may NOT do

The ledger's **open count** is published beside the gate's verdict and checked in CI as a two-sided
ratchet: equality by default, may shrink freely, and may only grow through a run that adds entries
**with their PR named**.

🔴 **The ratchet is READ-ONLY in CI, and this is a permission boundary, not a preference.** A CI job
that *writes* the ledger needs `contents: write`; `mutation.yml` sets `contents: read`. Changing that
is an owner workflow edit and is **out of scope for this brief**. Therefore:

- **`ingest` runs from a session or a local checkout**, and its commit rides the PR like any other
  file. The tool side needs no permission at all.
- **CI only READS** the committed ledger to evaluate the ratchet.
- The carrier already exists and needs nothing built: both lanes upload the verdict as an artifact
  (`mutation-diff`, `mutation-diff-js`, `if: always()`, verbatim tool JSON). What is missing is not
  the carrier but the **addressing** — an artifact is reachable only by run id, with nothing on the
  merged commit pointing at it, and retention is 90 days, which is already the repo maximum.

### 2e · Advisory stays advisory

This brief does **not** propose making `mutation (diff-scoped)` a required context. Whether that
gate gates is the owner's decision (it has been raised with the row above as the concrete case) and
nothing here should be read as pre-empting it. The ledger's value does not depend on it: it converts
a finding that is *lost* into one that is *recorded and open*, which is worth having whether or not
the gate ever blocks a merge.

> ⚠️ **Superseded by the owner, 2026-09-28: the gate IS required.** `mutation (diff-scoped)` is in
> `main`'s ruleset alongside `biome`, `browser-gates`, `no-network`, `stale-file`, `test`,
> `test (py3.12)`, `test (py3.13)` and `typecheck` (read from
> `gh api repos/Plantucha/Tepna/rules/branches/main`, not assumed). The paragraph above is kept
> because its *reasoning* still holds — the ledger's value never depended on the gate blocking — but
> its factual claim no longer does, and a brief that states a false fact about a gate is worse than
> one that says nothing. The consequence is the one §1 predicted: every red is now a drain that must
> be closed, which is what §2f is about.

### 2f · A survivor has THREE answers, not two

§2c frames the ledger as a two-way choice: **kill** the mutant, or **record** it with the argument for
why it cannot be killed. Three drains in three days produced a third answer often enough that leaving
it unnamed was pushing sessions toward the wrong one of the first two.

**The third answer: the mutant is telling you the line decides nothing, so the line goes.**

Neither a test gap nor an equivalence. The mutant survives because the code it mutates cannot change
an outcome — and recording it as equivalent *preserves* that, which is the harm. Three instances,
all measured, all from the gate running on the gate's own code:

| # | the survivor | what it was actually saying |
|---|---|---|
| **#3211** | `copy.deepcopy(node) → copy.copy(node)`, `getattr(clone, "body", None) → getattr(clone, "body", )`, `old_fns.get(n) → old_fns.get(None)` | `by_stem` built a full-dump map *and* a docstring-stripped map, and the stripped comparison then re-checked the full one. If the full dumps differ the stripped ones differ too, unless the difference is exactly the docstring — the case being exempted. **The map decided nothing**, so no mutation of its lookup could change an answer. The `deepcopy` existed only to feed it. Three survivors, one deletion, no new tests. |
| **#3214** | `split(".", 1)[1] → rsplit(...)`, `→ maxsplit 2`, `→ maxsplit absent` | All three agree with the original on every input that can occur: the glob is built in exactly one place and carries exactly one dot. **Unkillable as written** — and the reason they agree is the reason the line was wrong. Hand it a shape it does not expect and it picks a middle segment, the regex matches nothing, and the count returns 0. Recording them as equivalent would have preserved a silent zero one line below the fix for silent zeros. The answer was to **state the contract** (one dot parsed, none is a bare stem, two or more raise), which is also what made the line killable. |

The two arrive from opposite directions and land in the same place:

- **#3211 — the line decides nothing.** Remove it. The mutant was a measurement of redundancy.
- **#3214 — the line was never pinned.** State what it requires. The mutant was a measurement of an
  unstated assumption.

**How to tell the third answer from the second.** Ask what the mutant would do on an input that *can
occur*. If the answer is "nothing, ever, by construction" — because a second computation already
decides it, or because the input shape it distinguishes cannot reach here — that is not equivalence,
it is a line with no job. An equivalence entry says *"this mutant is unkillable and the code is
right"*; the third answer says *"this mutant is unkillable and the code should not be here"*. Only
the second sentence stops the next reader from trusting a line that decides nothing.

**Why it matters for the ledger specifically.** Every third-answer case recorded as equivalent grows
`mutate-equivalence.json` by an entry that will be re-read, re-keyed across every reformat, and
re-argued by whoever next touches the function — and it keeps the defect. The ledger should grow only
where a real, unkillable mutant sits over correct code.

## 3 · Acceptance

1. `mutation-survivors.json` exists, committed, with the entry shape of §2b and a `_README`.
2. `ingest <verdict.json> --pr N --lane py|js` adds one entry per survivor, keyed per §2a,
   idempotent on re-ingest of the same run, and refuses per §2c (each refusal has a test).
3. `list` prints open entries; `close <key> --killed #N` / `--equivalent <probe>` closes one, and
   **only the tool removes rows**.
4. A later gate run that kills or excuses a recorded mutant closes its entry.
5. An entry whose key no longer matches any generated mutant is reported **orphaned**, never dropped.
6. The open count is published beside the verdict and checked as a two-sided ratchet in CI (read-only).
7. **PLANT**: a run that reports a survivor and merges without answering it leaves an `open` entry,
   and the ratchet reds on the next PR touching that function.
8. **CONTROL**: today's verdicts are byte-identical apart from the new count.
9. The #3022/#3024 survivors are ingested as the first real entries, with their state as measured
   today — **twelve**, not the ten the row names (see §1), each with its `diff_key`, all `open`.

### Verified 2026-11-01 — seven of nine hold, and item 4 should not

Read-only against `tools/mutation-survivors.mjs` and the committed ledger. One item asks for something
unsafe, so it carries a correction rather than a tick.

| item | holds | evidence |
|---|---|---|
| 1 | yes | `mutation-survivors.json`, 128 entries, `_README` present, §2b fields |
| 2 | yes | `cmdIngest`, with a selftest leg per refusal |
| 3 | yes | `cmdList`, `cmdClose`; the tool is the only writer |
| 4 | **no, deliberately** | see the correction below |
| 5 | yes | `cmdOrphans` plus the `orphaned` state; three entries carry it |
| 6 | yes | `verify:survivor-ratchet` in CI, two-sided, read-only |
| 7 | partly | the mechanism has legs; no end-to-end plant over a real verdict |
| 8 | unverified | no leg by that name; the byte-identical leg covers the key migration instead |
| 9 | yes | twelve entries carry `pr: 3022` |

**Correction to item 4.** An open entry ABSENT from a later verdict must NOT close. Absence cannot tell
a kill from a mutant the run never generated. `mergeEntries` reports `regressed`, `stale` and `unknown`
for that reason. The honest form of item 4 is narrower: a later run that NAMES the mutant as killed
closes the entry, and silence closes nothing.

A third state arrived on 2026-11-01. An entry whose recorded line has grown under it reads `stale-line`:
no run can produce its mutant again, so the ratchet excludes it and the verdict's population says so.

## 4 · Non-goals

- No full sweep, in either lane. The cost is the reason the gate is diff-scoped.
- No re-running capture.py mutants locally: the #3185 memory refusal applies, and those stay CI-only.
- No change to branch protection or workflow requiredness (owner's decision).
- No change to how survivors are FOUND — only to what happens to one after it is reported.
