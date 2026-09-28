<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED — 2026-09-28 · **Created:** 2026-09-28

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

## 4 · Non-goals

- No full sweep, in either lane. The cost is the reason the gate is diff-scoped.
- No re-running capture.py mutants locally: the #3185 memory refusal applies, and those stay CI-only.
- No change to branch protection or workflow requiredness (owner's decision).
- No change to how survivors are FOUND — only to what happens to one after it is reported.
