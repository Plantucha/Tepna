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
the queue on reboot"*. That assertion **fails from any worktree under `/tmp`**, which is where sweeps
run. Fixing the path resolution and leaving that assertion as-is will red the tool for everyone.

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

## 3 · BUILD THE MAP — sequencing, not difficulty

`node tools/mutation-suite.mjs --build-map` (~10 min, needs a quiet box). It must run **after** a
`tests/dex-tests.js` change settles: the map's values are group **indices**, so an inserted group
shifts every later one and the identity stamp correctly refuses the map. #1453 inserts a group at
line 7760; building before it merges buys a map the guard immediately rejects.

**Done when:** `--status` reports `selection ON` for every DSP, and a sweep's per-file line reads
`✓ coverage map applied`. §6's estimate is 10–100×; **that number is quoted, not measured here**, and
this brief is not done until a before/after on one real file replaces it.

---

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
