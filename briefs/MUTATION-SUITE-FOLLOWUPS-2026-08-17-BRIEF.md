<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED — 2026-08-17 · **Created:** 2026-08-17

# MUTATION SUITE — FOLLOW-UPS

Executes-from: `MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md` §6 · `MUTATION-COVERAGE-SELECTION-2026-08-14-BRIEF.md`.
Spawned by building `tools/mutation-suite.mjs` (PRs #1443, #1450). Everything here is something the
build **discovered** and did not finish, plus two decisions that are the owner's rather than mine.

---

## 0 · WHAT THE BUILD FOUND, IN ONE TABLE

Each of these was invisible before something looked, and each failed **quietly** — the property they
share, and the reason they lasted.

| finding | measured | why nobody saw it |
|---|---|---|
| the coverage map never reached a sweep | ecgdex 290 min, oxydex 193 min unselected | absent map ⇒ tag-filter fallback: fails safe into *slow*, never *wrong* |
| the map carried no identity | `{ generated: null }`, no hashes | a stale map and a fresh one were indistinguishable |
| **ten** tools cache to gitignored `.mutation-sweeps/` | 10 of them, §👥.1 puts everyone in worktrees | an empty cache is indistinguishable from a cold start |
| `doc-search.mjs` excluded `.js` | 278 decision-bearing comment lines unindexed | an out-of-scope corpus returns a clean empty result |
| the equivalence ledger has rotted | **379 of 383 keys match nothing** | a line-key miss reads as "unclassified" |
| the driver dropped the canary | counts came from the journal, not the result | a void sweep looked like an ordinary one |

---

## 1 · MIGRATE THE OTHER NINE TOOLS TO `sharedStatePath`

`tools/mutation-map.mjs` exports `sharedStatePath(root, name)` — the git **common** directory, which
resolves to the same place from the main checkout and every linked worktree. `mutation-map` and
`mutation-suite` use it. The other nine still read repo-relative gitignored paths and therefore find
nothing in the checkout where work happens:

`mutation-worklist.mjs` (the work **queue**) · `survivor-witness.mjs` · `assertion-strength.mjs` ·
`witness-baseline.mjs` · `per-group-coverage.mjs` · `stmt-delete.mjs` · `extreme-mutate.mjs` ·
`doc-search.mjs` · `mutation-reach.mjs`

**Not done here deliberately:** nine tools with nine sets of path conventions and selftests, changed
while a sweep was running, is more than one change can verify. **Done when:** each reads through
`sharedStatePath`, keeps its in-tree path as a fallback, and its selftest asserts the shared location
is tried first.

⚠️ `mutation-worklist.mjs`'s selftest already asserts *"NO sweep path lives in /tmp — a tmpfs loses
the queue on reboot"*, and that assertion **fails from any worktree under `/tmp`** — the failure is a
false red that reads as a tool bug, so whoever migrates the paths should expect it.

*(Corrected 2026-08-17, same day: the first version of this line said `/tmp` "is where sweeps run".
That generalised from my own setup. Measured: **288 of 329 worktrees** sit on the work volume as
`../wt-*` siblings, which is what CLAUDE.md §👥.1's `git worktree add ../wt-<task>` produces; only
**22** are under `/tmp`, mine among them. So this is a real minority hazard, not the normal case —
and the overstatement is the same error as the rest of this brief, one layer up: a claim about the
world inferred from the one instance in front of me.)*

---

## 2 · RE-ANCHOR THE EQUIVALENCE LEDGER — and the key must be checkable at READ time

`tools/mutate-equivalence.json` holds 419 classifications (416 `no-distinguishing-input`, 3
`real-gap`) keyed by **line number**. Lines move, so:

- of ppgdex's 129 entries, **4** still match a survivor and **117 point at lines holding no survivor at all**;
- fleet-wide, **379 of 383 keys are dead**;
- `ecgdex`, `oxydex` and `integrator` — the three largest files — have **zero** entries.

That is real human triage effort that silently stopped applying. `--inventory` now prints the count
of classifications matching nothing, which makes the rot **visible** but is a symptom report, not a fix.

**The invariant to build to** (named by a peer session, and it is the right one): *a key that can
silently stop matching is what caused this — the new key must be **checkable at read time**, not only
at build time.* A miss must be distinguishable from "unclassified"; today it is not.

Prior art in-repo: `mutate.mjs` computes `fnHash(line)` — a hash of the **enclosing function**, so an
edit elsewhere in the file does not invalidate it — for exactly this problem. **Done when:** a
classification carries enough identity to say *"this no longer applies, and here is why"*, and the
inventory reports re-anchoring failures rather than silently under-counting.

⚠️ `(line, op)` is **not unique** — one line can host the same operator twice, so 419 entries
collapse to 383 keys. Where colliding entries disagree, one is equivalent and one is a real gap and
the key cannot say which; both must report **open**. Any new key must preserve that: over-reporting
is recoverable, inheriting "unkillable" from a neighbour hides a real gap for good.

---

## 3 · ⚠️ THE MAP UNDER-SELECTS AND MANUFACTURES FALSE SURVIVORS — measured 2026-08-18, QUARANTINED

**This section replaces a "build the map" task with a defect report, because building it is what
found the defect.** Built successfully (494 groups, 354 s, 9 sources stamped, written to the git
common dir so every worktree sees it). Then measured, paired, fresh journals, identical `--jobs 6`:

| | tested | killed | survived | wall |
|---|---:|---:|---:|---:|
| tag filter (no map) | 489 | **307** | 182 | 3 m 52 s |
| coverage selection | 489 | **304** | 185 | 2 m 39 s |

**Two findings, and the second is the one that matters.**

**(a) The speedup is 1.46×, not 10–100×.** §6's estimate is a projection nobody had measured; this is
the first real number and it is 7–70× smaller. hrvdex has cheap groups, so a heavier file may do
better — but the headline figure must not be quoted again without a measurement beside it.

**(b) SELECTION CHANGED VERDICTS IN BOTH DIRECTIONS — 9 flips in 484 mutants.**

- **3 SURVIVED → KILLED.** Selection is a genuine *gain* here: it runs groups that execute the line
  without carrying the node's tag, which the tag filter never runs at all. The tool documents this
  ("selection is NOT a subset of the tag filter"), and it means the tag-filtered numbers this
  programme has published are themselves slightly under-counted.
- **6 KILLED → SURVIVED.** This is manufactured blindness, the failure `per-group-coverage.mjs`'s own
  header names: *"a selection map that silently drops a group stops running tests that would have
  killed mutants, and reports the resulting survivors as findings."* All six are at
  `hrvdex-dsp.js:853` and `:866`, and all six were killed by one group —
  **"HRVDex Phase-9 — compute() surface + summary adapter"**.

**Root cause, located but not fixed.** The three Phase-9 groups (indices 314, 323, 338) attribute
**0 hrvdex lines** in the map, while demonstrably killing mutants on those lines — a test cannot kill
a mutant on a line it does not execute, so the coverage measurement for those groups is wrong. They
are **not** flagged `unknown: true`, so the fail-closed path never fires: an empty attribution is
treated as "executes nothing", which is indistinguishable from "nothing was recorded". Line 853 is
not in the baseline either, so the baseline-selects-everything escape does not apply.

**The map is QUARANTINED** (`per-group.json.QUARANTINED-underselects` in the git common dir).
Sweeps fall back to the tag filter — slower and correct. **Do not restore it** until the empty
attribution is either explained or made to fail closed.

**Done when:** an attribution of zero lines for a group that the suite can be shown to execute is
treated as `unknown` (fail closed) rather than as "executes nothing"; the paired hrvdex comparison
shows **zero** KILLED→SURVIVED flips; and the speedup is re-measured and quoted *with* the file and
job count it was measured on.

⚠️ This is the third time in two days that a mechanism failed by reporting an empty result rather
than an error, and the first time it would have corrupted a published number rather than merely
costing time.

## 4 · WIRE THE REMAINING LANES INTO THE INVENTORY

`--lane pseudo` and `--lane delete` run, are watchdogged and resume — but this driver does not parse
their record formats, so the public list reports the **operators** lane only. That is honest today
(the summary says so, and refuses to print counts it did not read) and incomplete.

**Done when:** the inventory carries per-lane sections, with the units kept apart — a pseudo-tested
**function** is not a surviving operator **mutant**, and the two must never be summed.

---

## 5 · TWO DECISIONS THAT ARE THE OWNER'S

**5a — A RATCHET, NOT A GATE.** Mutation is deliberately not a gate here, and the reason is recorded:
a gate that reds on equivalent mutants is a gate someone switches off, and the real failures go with
it. A **non-regression ratchet** — the kill rate for a file may not fall — does not have that
property, because a fall is always a real change. Not built; it is a policy choice about CI, not a
tooling gap.

**5b — MODEL-GENERATED TESTS ARE A RECORDED NON-GOAL.** The local model is wired for exactly one job
(`--cluster`: group survivors by shape so a reader writes one test per family) and is marked ADVISORY
everywhere. It must **not** be extended to draft assertions. Calibrated on this repo it scored **0/4**
judging code correctness and **0/3** counting, and a plausible-but-wrong assertion is worse than none:
it passes, it is quoted as evidence, and it could never have failed — the hollow gate this entire
programme exists to find. Recorded here so a future session does not rediscover it as a good idea.

---

## 6 · THE PATTERN WORTH CARRYING OUT OF THIS

Every finding above is the same shape, and it is the shape CLAUDE.md §👥.4b already names: **a check
that ran, examined nothing, and reported cleanly.** The variants met here in two days:

- an absent corpus returning a clean empty result (`doc-search`);
- an absent cache indistinguishable from a cold start (ten tools);
- a stale key indistinguishable from "not classified" (the ledger);
- a crashed selftest scored as a survivor because the counter grepped for `✕` (my own plant harness);
- a module running its selftest **on import**, so the importer's assertions never ran and reported green (my own `mutation-map.mjs`);
- `0 tested · 0 killed` printed for a lane whose records were never parsed, next to that lane's own real output (my own driver).

Three of those six were mine, written **while** documenting the trap. Proximity is not protection —
the defence is a control that must come back positive, not a paragraph. Every gate added here follows
that rule: the canary must die, the corpus must contain `clock.js`, the identity must match, and a
refusal must state which input moved.
