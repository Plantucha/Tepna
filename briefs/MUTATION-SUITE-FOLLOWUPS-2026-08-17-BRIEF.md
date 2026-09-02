<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** IN-PROGRESS — 2026-08-24 · **Created:** 2026-08-17 · **DRAIN 2026-09-02 (Osprey):** tracked by section rather than checkbox — **4 of 11 sections carry a DONE marker**. Not stampable as a unit. **Owner: Osprey. Next step:** convert the remaining sections to checkboxes or split them out; the section-level format is why this brief reads as stalled when parts of it have shipped.

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

## 1 · ✅ DONE 2026-08-19 — MIGRATED, and the queue reads from a worktree for the first time

> **Executed.** Eight of the nine migrated (`mutation-reach` turned out to have NO implicit state
> path — its `--cov` is explicit-only, so there was nothing to migrate; recorded rather than forced).
> Helpers live in `mutation-map.mjs` (`resolveStatePath` · `stateDirs` · `resolveStateDir` ·
> `stateJsonFiles`), each tool imports them, and every selftest asserts the shared location is tried
> first — 267 selftests green across the lane after the change.
>
> **Two design points the execution settled, both paid for by a wrong first draft:**
> - **Resolution is per-FILE, not per-directory.** First draft picked first-existing-DIR — and the
>   shared dir already existed (the drafts live there), so eight present sweeps read as a lost queue.
>   Existence of a directory says nothing about which files are in it.
> - **The directory-scanners UNION both candidates** (`stateJsonFiles`, shared wins basename ties),
>   because during the transition the state is genuinely split.
>
> The predicted `/tmp`-worktree false red did not fire (this checkout is on the volume); the
> worklist's OLD "default dir is inside the repo" assertion DID fire and was rewritten to the
> surviving invariant — resolves to a declared candidate, never an invented third place.
>
> **Data placed:** the nine crawl sweeps (1.5 MB) copied into `.git/tepna-mutation/` under the
> derived names, each parse-verified. Measured payoff: `mutation-worklist` from a linked worktree
> now prints the real queue — 4487/9938 distinguishable, 5451 unresolved — where before the
> migration every worktree printed `NO SWEEP DATA`.

## 1 (original) · MIGRATE THE OTHER NINE TOOLS TO `sharedStatePath`

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

## 2 · ✅ DONE 2026-08-18 — RE-ANCHORED ON TEXT, 4 of 129 matches became 126

**Closed by #1486, and the fix needed no ledger format change at all**: `before` and `after` were
already recorded in every entry, so only what is *read* changed. Keyed by `(op, before, after)`
instead of `(line, op)`, measured on the one file with a journal to check against:

| key | matches (ppgdex, 129 classifications) |
|---|---:|
| `(line, op)` — the rot | **4** |
| `(op, before, after)` | **126** |

The inventory now reports **139 classified** for ppgdex against 4, and its open count falls
**804 → 669**. The three that still miss are correct misses — killed since, or genuinely edited.

**Exact text, not a truncated prefix**: cutting both sides to 100 chars scores the same 126 while
introducing **33 colliding journal keys**, so it buys nothing and costs the ability to tell distinct
mutants apart. The price is that 39 entries written truncated at exactly 100 chars can never match —
**reported** via `staleClassifications`, never hidden, which is the read-time invariant below.

⚠️ `describeMutant`'s `before`/`after` are **display** fields (72 chars). Keying on them would have
conflated two mutations of the same long line — truncation-reads-as-the-whole, aimed at the very
field that decides whether a survivor counts as resolved. `rawBefore`/`rawAfter` were added and only
the raw pair is a key.

*The original section is kept below: the reasoning is what made the fix cheap, and the fnHash route
it proposed was NOT needed once the text fields turned out to be already present.*

### 2a · The original analysis (retained)

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

**ROOT CAUSE RESOLVED 2026-08-18 by experiment — the COVERAGE MEASUREMENT is wrong, and the
consequence is bigger than the bug.**

*(This paragraph has been claimed, retracted as unproven, and now proven, in that order. The
retraction was right at the time: I had asserted a cause from a contradiction rather than testing
it.)*

The decisive test, which cost about a minute: mutate `hrvdex-dsp.js:853` (`v > 0` → `v >= 0`) and run
**only** group 338. It **fails** — 1 failing, 46 passing, exit 1. A test cannot detect a change to a
line it never executes, so group 338 executes line 853, and the map that says otherwise is wrong.

Corroborating: c8's report for that group holds exactly **one** `hrvdex-dsp.js` record with **384**
executed lines — *precisely the load-time baseline count*. It captured the module load and none of
the group's own calls into it. (Mechanism hypothesised, not proven: per-group runs re-enter the DSP
through a realm whose compile c8 does not attribute back to the file. This repo already has one c8 ×
`vm.runInContext` attribution bug on record.)

**THE SCALE IS WHAT KILLS THE OPTIMISATION.** Group 338 attributes zero lines *anywhere*, and it is
not alone: **188 of 494 groups attribute zero lines to any DSP** (the build says so itself —
"306/494 group(s) execute at least one DSP line"). The map cannot distinguish *"this group touches no
DSP"* from *"this group's execution was not captured"*, and those demand opposite treatment.

The only safe reading is to treat every zero-attribution group as `unknown` and select it always.
That is **188 extra groups on every mutant** — against a tag filter that runs perhaps 40 for a node
file. **The safe map is slower than the filter it was meant to replace.**

So §6's "one optimisation worth building before more tests" is **blocked on a coverage-capture bug**,
not on effort: until a zero attribution provably means zero, selection is either unsafe (as measured:
6 lost kills) or pointless (slower than the tag filter). Fixing per-group capture is the real
prerequisite, and it was never on anyone's list because the map appeared to work.

### 3e · A SECOND SOURCE OF FALSE SURVIVORS — the reused scratch, **CAUSE ISOLATED 2026-08-24**

§3 is about the coverage MAP manufacturing false survivors. This is the same symptom from a different
place, found while killing the mutants `mutate_diff.py` reported on #1664, and it is recorded here
because the two are easy to confuse and the remedies differ.

**Measured, and each step is reproducible:**

1. `mutate_diff.py --base origin/main` on a **reused** scratch (`/tmp/mut-<module>-<hash>/`) reported
   **7 survivors** on `nightqc.x_summarize`.
2. `mutmut run nightqc.x_summarize__mutmut_18` in **that same scratch** → 🎉 **killed**, with no
   source and no test change in between.
3. `mutmut results` immediately after → **1** survivor, not 7.
4. The killing tests were present in `work/tests/` **and** in `work/mutants/mutmut-stats.json`'s
   `tests_by_mangled_function_name` for that function.

So the mutants were already dead and the tool's reported state was stale until something re-ran them.

## 🟢 THE CAUSE, ISOLATED 2026-08-24 — and candidate 1 was right

**The verdict is not a function of (source, tests). It depends on cache state, and a run refreshes
that state as a side effect of reporting it.** Seven runs, one rule:

> **The first run after a test is ADDED does not credit it. That run refreshes the cache, so the
> NEXT run is correct.** A test that is MODIFIED is credited immediately.

| run | change since previous | verdict |
|---|---|---|
| 2 | 7 tests **ADDED** | **STALE** — 26 survivors, 20 of them provably dead |
| 5 | 1 test **MODIFIED** | correct |
| 6 | 1 test **ADDED** (a killer, hand-verified alone) | **STALE** — reported surviving |
| 7 | **NOTHING AT ALL** | **correct** — same mutant reported killed |

🔴 **Run 7 is the whole proof: byte-identical tree, opposite verdict.** It is also the only experiment
that could have settled it — every earlier attempt changed something, and so could not separate "the
change fixed it" from "a second run fixed it".

**Where it lives:** `mutants/<module>.meta` holds `exit_code_by_key` — the per-mutant verdicts — and
carries `hash_by_function_name` for invalidation. Those are **SOURCE** hashes; the tests appear
nowhere in that key. So candidate 1 of the three listed below, *"mutmut's own per-mutant result
persistence"*, is the one, and §3e's refusal to guess was the right call: two of the three candidates
were wrong and the wrong one was the more intuitive.

⚠️ **ONE THING REMAINS UNEXPLAINED, and it is stated rather than smoothed over.** If tests are absent
from the invalidation key, a MODIFIED test should have been missed too — and run 5 shows it was
credited immediately. So the invalidation is sensitive to test *content* by some path not yet found.
The ADD case is proven; the MODIFY asymmetry is measured and unexplained. **Do not write a mechanism
for it without running the experiment.**

⚠️ **Three corrections to my own earlier reasoning on this, each of which sounded right:**
1. *"The scratch reuses the results database"* — refuted by fact 4 above, exactly as this section said.
2. *"The test-to-mutant association is stale"* — undercut by reading `mutmut-stats.json`: the added
   test **is** in `tests_by_mangled_function_name`. (That file is written **by the run**, so it can
   show the post-run state while the run used the pre-run one; it cannot settle the question either way.)
3. 🔴 *"Clearing the scratch fixes it"* — **a CONFOUND, and it was this defect's founding evidence for
   two weeks.** Every run that "proved" clearing worked was *also* a second-run-after-the-change. Run 7
   isolated the variable by clearing nothing.

**The remedy in §3e's advice list is unchanged and still correct** — re-run the one mutant by name
before believing a local survivor — but it now has a reason: you are not working around a mystery, you
are forcing the refresh that the *next* run would have done anyway.

**Original text retained below, because the reasoning it refused to do is why the answer is trustworthy.**

🔴 **THE CAUSE WAS UNISOLATED UNTIL 2026-08-24, AND THIS SECTION DELIBERATELY DID NOT NAME ONE.** The first write-up of
this — including #1664's commit message, which is merged and carries the wrong phrasing — asserted
that the scratch "carries mutmut's results database forward". Fact 4 above refutes that framing: the
test copy and the coverage mapping were both current. Three candidates remain and none is established:
mutmut's own per-mutant result persistence; `mutate.py:290`'s selection (`only or f"{stem}.*"`); or
something else entirely. **Naming a mechanism that the tree does not support is how a record sends the
next reader chasing the wrong thing** — the same failure §3a records for the coverage map's "obvious
rescue", one tool over.

**Actionable regardless of cause:** the symptom is a **false RED, and that direction is the expensive
one.** A false green is caught by the next honest run; a false red tells you the tests you just wrote
do not work, which is a conclusion people act on. It cost two rounds of re-writing already-passing
assertions before a hand-applied mutant settled it.

- **CI is unaffected and is the authority** — a fresh checkout has no reusable scratch. Trust the
  `mutation (diff-scoped)` job over any local run.
- **Locally, before believing a survivor, re-run that one mutant by name** (`mutmut run <mutant>` in
  the scratch). It costs seconds and flips a stale verdict.
- ⚠️ **A `.pyc` same-size collision was proposed as the mechanism and does NOT fit** — the survivor set
  contained both same-size and size-changing mutants (`_pool = None`, `is not None`→`is None`,
  `0 <=`→`0 <`), while a size-CHANGING one (`<`→`<=`) was reported killed. Size does not partition the
  set. The documented `.pyc` mechanism stands for its own original incident; it does not explain this.

### 3a · The obvious rescue does NOT work — tested, not assumed

A peer session proposed the natural fix, and it is the one anyone will propose again: *the "384 =
exactly the baseline" signature is itself the discriminator.* Split the 188 by comparing each group's
per-module record against the load-time baseline — `record == baseline` ⇒ capture failed ⇒ select it;
`record ⊂ baseline` or empty ⇒ a true zero ⇒ safe to skip.

**Measured, one c8 run, and it is refuted:**

| group | records for `hrvdex-dsp.js` |
|---|---:|
| **2** — `Clock Contract — parseTimestamp` (touches `clock.js`, not hrvdex) | **384 lines** |
| **338** — provably executes `hrvdex-dsp.js:853` (fails when it is mutated) | **384 lines** |

**Identical line sets**, not merely equal counts. The reason is structural: `tests/run-tests.mjs`
loads **every** DSP before **any** group runs, so the load-time baseline is present in every group's
record whether or not that group touches the module. A true zero and a capture failure are not
similar observations — they are *the same observation*.

So the discriminator cannot be recovered from the coverage data as currently collected. Any real fix
has to change what is **collected** (attribute a group's own calls back to the file), not how the
collected data is **interpreted**. Recorded here so the next reader does not spend the run
re-deriving it — the hypothesis was good, and it took one measurement to close.

### 3c · ✅ A MECHANISM THAT DOES WORK — interval coverage, validated 2026-08-18

§3a proves the *interpretation* layer cannot recover the distinction. It does not follow that the fix
is expensive. A peer proposed snapshotting V8 coverage around each group and diffing, on the
assumption that counts accumulate — and named the control that had to fire first: **counts must be
monotonic, or a before/after diff is wrong in a way that looks fine.**

**The control fired, and it refuted the method while validating the goal.** `Profiler.takePreciseCoverage`
**resets on read** on Node 22: `work()` called once before each of two snapshots reported `1` and `1`,
not `1` and `2`.

Which makes the fix *simpler* than the proposal, because reset-on-read means each snapshot already
**is** the interval:

| interval | what ran | reported |
|---|---|---:|
| 1 | 3 calls | **3** |
| 2 | nothing | **0** |
| 3 | 1 call | **1** |

So per-group attribution needs **no diff**: `startPreciseCoverage({callCount:true, detailed:true})` →
load everything in the normal co-load order → **take once and discard** (that snapshot is the
load-time baseline) → run the group → **take again**. The second snapshot is exactly that group's own
execution, with the baseline already gone. Nothing about load order, module identity, or group
execution changes — only the accounting.

That matters because the obvious alternative — loading DSPs lazily per group — is *not* available:
`dex-coload.js` and the co-load gate deliberately pin `clock.js` before every delegating DSP, and
deferring loads would change semantics the suite exists to hold.

⚠️ **RESET-ON-READ MAKES THE COUNTER A SHARED, DESTRUCTIVE RESOURCE — do not compose this with c8.**
Whoever reads the interval consumes it. If the map-build harness reads throughout a process that c8
also wraps, c8's totals collapse to whatever the last interval happened to contain — and it does not
error, it reports *lower* coverage, so a floor either reds for a fabricated reason or passes on a
number describing one group.

Measured, partially: c8 collects via **`NODE_V8_COVERAGE`** (a file dump at exit), not an in-process
inspector session, so the two may not collide at all. I could not settle it — two attempts to probe
the interaction were both silently excluded by c8's own path/include filtering, first because the
subject sat outside the project root and then because it was not in the configured include set. That
is the third instance tonight of a check that ran and examined nothing, and it is the reason to stop
probing and **take the guard instead of the claim**: the harness should refuse to start when
`NODE_V8_COVERAGE` is set, which costs one line and is correct whether or not they interact.

**Not implemented.** `run-tests.mjs` already runs one group per process via `--group-index`, so the
snapshot pair can live in the harness without giving `group()` start/end callbacks — which is the
change this file's header rejected, because `tests/dex-tests.js` is the file every parallel PR
conflicts in. **Done when:** a rebuilt map shows group 338 attributing `hrvdex-dsp.js:853`, and the
paired hrvdex comparison of §3 shows **zero** KILLED→SURVIVED flips.

### 3b · The half of this that SURVIVES the quarantine

The three `SURVIVED → KILLED` flips are a property of the **tag filter**, not of the map, so they
outlive it: selection ran groups that execute a line without carrying the node's tag, and they killed
mutants the tag-filtered sweep recorded as survivors.

**Therefore every survivor count this programme has published is an UPPER bound, and every kill count
a lower one.** On hrvdex the error is 3 in 489 (0.6 %). It is not large, but it is signed — always in
the same direction — and it means "3751 survivors" should be read as "at most 3751". Cheap to
confirm on any file: run it once with `--full`.

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

### 3d · ✅ EXECUTED 2026-08-19 — interval coverage BUILT and the quarantine RE-CONFIRMED on better evidence

**§3c's design is implemented** (`tests/run-tests.mjs --interval-coverage`, consumed by
`per-group-coverage.mjs` — no more c8): inspector session started before any load, baseline take
discarded, second take = the group's own interval. The collection defect is FIXED and the signature
reversed: the Clock-Contract group, which under c8 carried hrvdex's entire 384-line load baseline,
now attributes NOTHING; a certain-execution group attributes 243 real hrvdex lines; 22 groups
attribute hrvdex where c8's data could not distinguish any.

**And with correct collection, per-line selection is STILL unsound — three mechanisms, each measured:**

1. **State-dependent paths.** hrvdex:801/869 are absent from the killing group's SOLO interval and
   present when the tag set runs together — the executing branch depends on state earlier groups
   build. A per-group map is blind to it by construction.
2. **Load-executed lines.** 158/174/487/537/1319 appear in NO group's interval (the baseline discard
   is the design), yet their mutants alter load state and die under the tag filter.
3. **Non-behavioural reds.** Widening selection to the zero-attribution groups first manufactured
   **22/22 fabricated kills** — the undeclared-skip audit red in `.git`-less workers (now fixed
   properly: three `known-drift` declarations in `tests/expected-skips.json`, with the incident
   noted). Two probe layers (worker-clean baseline + a comment-only integrity probe) now vet the
   zero set inside `mutate.mjs`.

Final paired measurement, hrvdex, fresh journals: tag 38 kills / selection **31** — 7 real kills
lost. **Selection is therefore OPT-IN (`--use-coverage-map`) and the default stays the tag filter**;
the evidence lives at the refusal site in `pgmapFor`. The map itself remains valuable as a
diagnostic (reachability, invalidation hints, the §4 inventory).

**The sound design, recorded for whoever builds it:** UNION-WITH-TAG — selected = tag-matched
groups ∪ map line-groups ∪ vetted zeros. A superset of the tag set cannot lose a tag kill by
construction, and the first (unsound) A/B showed 3 genuine SURVIVED→KILLED gains from cross-node
groups the tag filter misses, so the union buys real kills at ~tag cost. Not built tonight: it needs
tag→index resolution in `mutate.mjs` and its own paired measurement.

## 4 · ✅ DONE 2026-08-19 — per-lane sections, units kept apart, absence reported as ABSENT

> **Executed.** `parseLaneLedger` reads the ResumeLedger JSONL the two lanes persist under
> `--resume` (last record per key wins — a resumed ledger replays; a torn final line is skipped),
> `laneLedgerCandidates` finds them across BOTH state dirs per §1 (delete-lane per file+group, all
> groups counted), and the inventory now carries a per-lane section each — pseudo in **functions**,
> deletion in **statements**, the operators table above in **mutants**, with no cross-lane total
> anywhere by construction. A lane with no persistent ledger prints an explicit refusal ("absent
> INPUT — NOT a clean bill") rather than zeros, which is also the LIVE state today: neither lane has
> a surviving `--resume` ledger post-reboot, and the regenerated inventory says exactly that.
> 12 selftests; 3 planted mutations (first-record-wins, cross-file ledger leak, empty-lane-as-clean)
> all killed. One honest limit recorded in the section itself: a lane run WITHOUT `--resume` leaves
> no persistent record, so the inventory can only ever report resumed runs.

## 4 (original) · WIRE THE REMAINING LANES INTO THE INVENTORY

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

**5b·AMENDED 2026-08-18 — the boundary was drawn in the wrong place, and the corrected one is
sharper.** The reasoning above is sound and is unchanged; what was wrong is the conclusion drawn from
it. "The model must not draft assertions" conflates two different acts, and only one of them is
dangerous:

| the model supplies | can it be wrong? | who checks it |
|---|---|---|
| an **expected value** | yes, invisibly — this is the 0/4 case | nothing; it passes and is quoted as evidence |
| **which field to compare** | yes, but *visibly* | `projectionDiscriminates`, exactly, in microseconds |

`--draft` (shipped 2026-08-18) supplies only the second. The expected value is copied **verbatim from
the real code's recorded output**, so the model has no channel through which to state a falsehood
about behaviour; its worst case is proposing a field that does not discriminate, which is rejected by
a pure function over recorded JSON. The generate-and-test asymmetry is doing the work here: proposing
is cheap and unreliable, verifying is exact and free.

This was possible only because the crawl **already recorded a distinguishing input** for 346 of the
363 killable mutants — so drafting is transcription, not search, and transcription is the regime the
local model is measured *good* at. Had the input not been recorded, §5b as originally written would
still be the right call.

⚠️ **The residual hazard is real and is NOT covered by any of the above:** a projection can
discriminate and still pin the **wrong** behaviour — asserting what the code does rather than what it
should. The mutant dies either way, so no verification detects it. That is why `--draft` writes to a
review file and never into `tests/dex-tests.js`, and why the PROPERTY line exists at all: it is the
sentence a human reads to decide. **Nothing this lane produces may be adopted unread.**

---

## 7 · ✅/⚠️ 2026-08-20 — THE PID FILE WAS A CLAIM, AND THE WATCHDOG DID NOT RECOVER INTEGRATOR

Found picking the fleet re-sweep back up after the 14:12 reboot. Three findings; the first is fixed,
the second is open and is the one worth someone's time, the third is a code fact that is **not** the
cause of the second and is recorded here so nobody spends an hour deciding it was.

### 7.1 · ✅ FIXED (#1575) — `suite.pid` reported a dead sweep as running, and the wrong file

`--status` printed `running: {"pid":74542,…,"file":"integrator-dsp.js"}` when neither pid existed and
a *different* file was being swept. Both halves wrong, nothing said so. The record is written at start
and unlinked only on a clean per-file exit, so every crash, SIGKILL and reboot leaves one that reads
exactly like a live sweep. Worse than cosmetic: `sweepState` fed the same record to `classifySweep`,
which returns **`in flight`** for the file it names — so a crashed file classified as somebody-else's
work forever and no sweep would pick it up. §0's table again, one row longer.

Now verified before it is believed, by two independent tests: a **boot** test (a record whose
`startedAt` precedes the current boot cannot describe a live process — the only test that survives
**PID reuse**, which after a reboot is not hypothetical) and `kill(pid, 0)`. The record names **two**
processes and they die separately, so `sweeping` (is this file being worked?) is now a different
question from `live` (is the driver there?) — the box was caught in exactly that state at 14:24, suite
54384 gone with its child 54591 still sweeping and reparented to `systemd --user`.

Same PR: an unrecognised argument no longer falls through the `has('--x')` chain into the fleet
launch. **`--help` started a full 22-worker sweep** — the flag a reader types *because* they do not
know what the tool does.

### 7.2 · ✅ RESOLVED 2026-08-20 — the stall was the WHOLE POOL, and the cost was never the mutants'

`integrator-dsp.js` stopped writing at **09:24** and the box stayed up until **14:12** — 4 h 48 m of
nothing, past `--stall-min 10` and `--max-restarts 3`, and the suite never advanced to `motiondex`
(no journal for it, then or since). So it was neither progressing nor giving up. Measured from the
preserved journal (`.git/tepna-mutation/journals-pre-resweep-2026-08-20/integrator-dsp.js.jsonl`,
2871 records, none torn):

| signal | value | what it rules in or out |
|---|---|---|
| STARTed, never verdicted | **23** | the run had 22 jobs — this is the ENTIRE pool plus one, dispatched and never returning |
| keys STARTed twice | **6** (max 2) | consistent with the watchdog firing and re-dispatching — see the caveat below |
| verdicts recorded | 1424 of 1447 dispatched | the run was healthy right up to the wedge |
| last three dispatches | all **line 5070** | `_wrappedSlopeFit`'s only early-out guard |

⚠️ **The doubled-key row needs a caveat, found while writing §7.5.** `mutate.mjs` had a duplicated
`jwrite({ k })` (introduced in #1178) that emits **two** START records per mutant — so a doubled key
is not, on its own, evidence of a re-dispatch. It fires only on the **serial fallback** taken when no
worker tree can be created, and this run had 22 workers (23 unverdicted keys against a pool of 22),
so that path was not taken and re-dispatch remains the reading. The duplicate is fixed here regardless:
`readJournalProgress` derives `inFlight = started − done`, which the resume line publishes as "N will
be re-tried or quarantined" and the inventory carries — so a degraded-mode run reported roughly twice
the in-flight work it had. **A count is only evidence once you know every way it can be incremented.**

**The load-bearing point is the first row.** `--resume`'s recovery model is *quarantine the jammed
mutant* — which presumes ONE poison mutant. What happened here leaves 22 more behind it, so a restart
re-enters the same hole with 22 fresh chances to wedge, and three bounded restarts cannot climb out.
That is a different failure from the 11 h 11 m single-probe wedge the watchdog was built for, and the
same watchdog cannot be assumed to cover it.

**The hypothesis was `_wrappedSlopeFit`, and it was RUN rather than assumed** (probe by the session
driving the fleet re-sweep; child process, 120 s hard timeout, 30k-row synthetic `{tMs, off}` trains,
20 case-runs, **zero timeouts**, nothing over 17.3 s):

| case | cost |
|---|---|
| `bool \|\|`→`&&` (2nd), `rrMs` 0 | 16.9 s |
| `bool \|\|`→`&&` (2nd), `rrMs` NaN | 16.7 s |
| `cmp >`→`>=`, `rrMs` 0 | 16.9 s |
| **CONTROL — valid input, UNMUTATED semantics** | **17.2 s** |
| `negate: drop !` | instant (throws on null rows) |

**Read the control row first, because it inverts the obvious reading.** Valid input costs the same
17 s as any mutant, so the mutants did not make the function slow — **`_wrappedSlopeFit` is
intrinsically ~17 s on night-sized rows**, a ~1600-step ppm grid search over every one of 30 000 rows,
and the guard is simply what decides how often that price is paid. Nor is `negate` slow at all: it
throws immediately. So "the guard mutants are expensive" is the wrong sentence, and it is the sentence
this section would have shipped had the probe not been run. The right one is that a guard mutant
**survives cheap scrutiny and can only be killed by an assertion big enough to be slow**.

**The collapse arithmetic:** ~17 s per call × several calls per equivalence leg × **22 contending
workers**, each lap further slowed by every sibling's lap. No single call ever hung — the per-mutant
timeout had nothing to fire on, which is exactly why 4 h 48 m produced zero verdicts instead of a
quarantine. And the 6 double-dispatched keys close it: the watchdog's re-dispatch bought a 23rd ticket
into the same queue.

**The fix is test-placement economics, not tooling** (#1579, and this distinction matters for anyone
reaching for the watchdog). The new guard group does **not** change `--bail` pricing — it *exploits*
it. Its inputs are 3–60 synthetic blocks rather than a corpus night, so the sweep's priced group
ordering runs it early, a guard mutant reds in **milliseconds**, and the expensive legs never run for
that lap. It pins refusals (null · 3 blocks · `rrMs` 0 · `rrMs` NaN), the exact floor (**four blocks
are enough — `< 4`, not `<= 4`**), and the fit itself (a planted 50 ppm drift recovered at
concentration 1; a driftless train reading 0 ppm at zero residual). All five guard variants verified
killed by direct re-application.

**Carried forward:** the watchdog hole in the first paragraph is NOT closed by #1579 — it is merely no
longer reachable through *this* function. Any other intrinsically-expensive function whose killing
assertion is corpus-sized can reproduce the same collective collapse, and the watchdog still cannot
see it, because nothing is hung. **The generalisable guard is pricing: a mutant whose only killer is a
slow assertion is a pool-collapse risk, independent of which function it lives in.**

### 7.3 · The pid file is unlinked on exactly ONE of four exit paths — and that is not why 7.2 stranded

`unlinkSync(pidFile())` appears **once**, inside `if (!outcome.stuck)`. So a give-up after
`MAX_RESTARTS`, the end of the fleet loop, and any crash all leave the record behind. Worth tidying —
but it did **not** produce the stranded record above, because a give-up would have advanced to
`motiondex` and rewritten the file, and it never did. Recorded so the tempting tidy-up is not mistaken
for a fix to 7.2. The reader-side check in 7.1 is the one that covers every path, including `SIGKILL`,
which no producer-side cleanup can.

### 7.5 · FOLLOW-UP — ENUMERATE the expensive-guard class instead of meeting it one collapse at a time

§7.2's carried-forward says the class is open: *any* function that is intrinsically expensive and whose
guard's only killer is corpus-sized can collapse a pool, and the watchdog cannot see it because nothing
hangs. Proposed by the session that measured §7.2, and it is a **query, not a new instrument** —
`mutate.mjs` already calibrates a clean lap per file (`baseMs`, and `calibrationIndices` over the union)
and already times laps; the missing piece is that **the journal does not persist a lap duration**, so
this needs one extra field on the verdict record before it becomes a query.

With that field:

- a **KILLED** mutant whose lap ran far over calibration was killed *only* by an expensive group —
  under `--bail` the cheap groups all passed, so its cheap killers do not exist. That is the class
  membership test, stated per mutant.
- a file's **SURVIVORS** need no timing at all: a survivor by definition ran **every** group, so it
  pays the full price by construction. Collapse exposure for a file is therefore roughly
  *survivor count × full-group-set cost*, and both terms are already known. This is the cheaper half
  and can be computed today.

The payoff is turning "you will meet it again at another file" into "here are the files you will meet
it at". **That list now exists, and it is recorded here BEFORE the sweep reaches those
files so it can be wrong in public.** Survivor counts from the fleet re-sweep in progress:

| file | survivors | file | survivors |
|---|---|---|---|
| oxydex | 1477 | glucodex | 479 |
| ecgdex | 1203 | pulsedex | 379 |
| integrator | 976 | motiondex | 257 |
| ppgdex | 808 | hrvdex | 182 |

⚠️ **This is the survivor term ONLY** — the full estimate is *survivors × full-group-set cost*, and the
second factor is not folded in numerically here (the sweep prints each file's calibration as it starts,
so it is available per file, not yet as a table). Read the ranking as an ordering hypothesis, not a
cost.

**The prediction, stated so it can fail:** `integrator` ranks third on survivors but should **not** be
among the worst legs, because #1579 converts its guard-mutant cluster — the exact class that collapsed
the pool on 2026-08-20 — from full-price to a millisecond kill. `oxydex` should be the worst.

- **Observable: RANK by wall-clock, never absolute time.** A days-scale sweep shares the box with
  whatever else runs on it, so absolute times are confounded by load that has nothing to do with the
  hypothesis. Rank is robust to any uniform slowdown. **Falsified if `integrator` finishes in the top
  three by wall-clock** among the fleet's files.

### ⛔ THE PREDICTION IS FALSIFIED — measured 2026-08-21, and the precondition WAS met

`integrator` finished **1859/1859 · 912 killed (+47 vs the old ledger) · 938 survived · 543 m 35 s
(9 h 04 m)**. Leg times so far: cpapdex 1.5 m · motiondex 1.3 m · hrvdex 2 m · glucodex 16 m ·
ecgdex ~5 h · **integrator 9 h 04 m**, with oxydex tracking ~2.7 h and only ppgdex/pulsedex left.
Integrator ranks **no worse than 3rd** by wall-clock however the remaining legs land, which is the
falsification condition as written.

**This is a REAL falsification, not an untested one.** The precondition was verified at the rung that
matters — 21 occurrences in the worker tree at pool build, same inode as the checkout — and the guard
group demonstrably worked *at the mutant level*: guard-cluster mutants died fast and kills rose by 47.
The fix did what it claimed; the prediction built on it did not.

**What the failure exposes.** The prediction's implicit claim was *"guard fix ⇒ cheap leg"*. That is
wrong for a reason the exposure model already contained and the prediction hand-waved: **kills are
cheap, survivors always pay the full set price, and #1579 barely moves the survivor count.** The guard
group fixed a **COLLAPSE** mode, not a **COST** mode — §7.2's stall account stands unchanged; what
falls is the inference that removing the collapse makes the leg fast.

⚠️ **The exposure arithmetic does NOT close, and the discrepancy is load-bearing.** Checked rather than
accepted:

| | predicted | measured |
|---|---|---|
| integrator, survivors-only at the ~9 min calibration set price | 938 × 9 ÷ 22 = **6.40 h** | **9.06 h** — a **29 % shortfall** |
| ecgdex cross-check, 1203 survivors × ~2.5 min | offered as ≈ 5 h | **2.28 h** — off by ~2× |

11 959 worker-minutes were actually spent. Reconciling them needs **either** a set price of
**12.75 min** rather than 9, **or** kills costing **~3.9 min each** rather than ~0. So *"kills are
cheap"* — the model's load-bearing assumption — is **not established**, and under `--bail` it need not
hold: a kill is only cheap if the killing group runs EARLY in the priced ordering.

**Consequence for the prescription.** Reducing integrator's leg means reducing **survivors** (kills,
equivalence-ledger entries) or the **set price** (splitting the corpus-priced groups) — that direction
survives. But the *magnitude* does not: if kills cost ~3.9 min, converting a survivor to a kill turns a
12.75 min lap into a 3.9 min one — a **3× saving, not elimination**. Anyone budgeting off "kills are
free" will over-promise by that factor.


⚠️ **EVERYTHING ABOVE IS *CONSISTENT-WITH*, NOT MEASURED — and the distinction is the point of §7.5.**
The 29 % residual is reconciled by *either* a 12.75 min set price *or* ~3.9 min kills, and nothing here
separates them: both are algebra over one wall-clock total, not observations. So the corrected model is
no better established than the one it corrects — it merely fits a number the other missed.

**The decisive instrument is the per-verdict LAP DURATION field this section already proposed.** With
it, "3.9 min per kill" stops being residual arithmetic and becomes a *distribution* — quantiles by
verdict, with killer-group position in the priced ordering as a covariate. That single field settles
the set-price question, the kill-cost question and future leg forecasting together.

**Why the assumption was seductive, recorded because it generalises** (the peer who made it named it):
the guard group was priced **early by design**, so guard-cluster kills genuinely *were* cheap — and
that true observation was generalised to *all* kills, for which nothing was measured. A cheap kill is
evidence about **where its killer sits in the ordering**, never about kills as a class.

**So the honest status of the falsification analysis: BLOCKED on that field** at any precision worth
budgeting from. The falsification itself stands — it rests on wall-clock rank, which is observed.
**The pre-registration earned its keep.** The prediction was recorded before the run with an explicit
falsification condition and a precondition check; it failed, the failure is attributable to a specific
wrong step rather than to noise, and the mechanism it exposed is more useful than the prediction would
have been had it held.

- 🔴 **PRECONDITION, and it must be checked BEFORE any verdict is recorded: #1579's guard group has to
  be in the tree the WORKERS hold when integrator's pool is built** — which is not the same file as the
  checkout's, and the difference is measurable rather than theoretical (below). The sweep runs from a
  checkout that was pinned when it started; if the group is not pulled in before that file begins, a
  slow integrator **falsifies nothing** — it is simply the 2026-08-20 scenario re-run, and reading it
  as a refutation would retire a correct account on evidence that never tested it. A fabricated
  disproof is worse than a fabricated proof here, because nothing downstream re-examines a hypothesis
  already marked dead.

**HOW to check the precondition — grep the WORKER tree, not the checkout.** Workers are `cp -al`
hard-linked copies built once per file, so a `git merge` into the sweeping checkout **breaks the link
and leaves the running pool frozen on the old bytes**. Measured live on 2026-08-20 while #1579 was
merged mid-`ecgdex`:

| file read | inode | `_wrappedSlopeFit` occurrences |
|---|---|---|
| the running pool's `w0/tests/dex-tests.js` | 1848293 | **10** (pre-#1579) |
| the checkout's `tests/dex-tests.js` | 1857358 | **21** (post-#1579) |

Eleven occurrences apart, while `git log`, `git status` and a grep of the checkout all agreed the group
had landed. So:

```sh
w=~/.mutate-w0-$(jq -r .child < .git/tepna-mutation/suite.pid)
grep -c _wrappedSlopeFit "$w/tests/dex-tests.js"     # 21 ⇒ precondition MET
```

The pool directory is suffixed with the **child pid**, which `suite.pid` records, so it names the right
pool even while a superseded pool is still draining. **21 there is the precondition; anything else is
not, whatever `git log` says.** One more rung of the same ladder: `origin/main` proves the commit
landed · the checkout proves it was pulled · **only the worker tree proves the processes that produce
the verdicts can see it.**

**Consequence for the ledger — stated carefully, because the careless version plants a false asterisk.**
`ecgdex` ran on the pre-guard file, by construction. Its verdicts are **nonetheless comparable in this
run**, and that was checked rather than assumed — diffing the two files directly:

```
removed lines: 0      added lines: 28      distinct group() calls added: 1
added group:  'Integrator _wrappedSlopeFit — the guard is CHEAP and the fit recovers a planted drift'
              tagged 'integrator-dsp · known-answer · mutation-pinned'
lines mentioning ecgdex: 0
```

The sole delta is one group outside ecgdex's tag selection, so ecgdex sees the same groups and the same
assertions under either file. **The general warning stands and the instance does not**: a pool frozen
across a merge is only incomparable when the delta **intersects that file's group set**, and here it
provably does not.

⚠️ Worth the extra paragraph, because the lazy version — "ecgdex's numbers are suspect" — is a **false
asterisk**, and a false asterisk is the small cousin of the fabricated disproof this brief warns about
elsewhere: it is never re-examined, so it quietly devalues a good measurement forever. Check whether
the delta touches the selection before qualifying anyone's numbers.

If the prediction fails **with** the precondition met, the expensive class at integrator is not (only)
the guard cluster, and §7.2's account needs **reopening rather than extending** — that cost lands on
§7.2, which is the right place for it, since §7.2 is what generated the prediction. ⚠️ Do not price a file by its *mean* lap — the distribution is what matters, and integrator's
own history is the warning: calibration alone was **312 s of a 339 s run** while the mutants cost ~25 s
(`mutate.mjs` §calibration). A mean over that is a number about the wrong thing.

### 7.4 · A required context can be ABSENT because it is PENDING — the benign twin of the matrix trap

Noticed while landing 7.1, and recorded here because it costs a queue-watcher the same hour the real
trap does. The required context **`test` does not exist in a PR's check rollup at all until the six
`suite (shard N/6)` jobs finish** — it is the aggregate over them. So a healthy PR sits with **7 of 8
required contexts green and the 8th simply not there**.

That is byte-for-byte the signature of the failure CLAUDE.md §5 warns about — *a required context that
was never reported at all*, where a skipped matrix job leaves an unexpanded literal name and **waiting
cannot fix it**. The two states need opposite responses (wait vs stop and fix the workflow) and the
rollup renders them identically, as an absence.

**The discriminator is the shards, not the aggregate:** shards still in flight ⇒ absent-because-pending
⇒ wait. Shards all terminal with `test` still missing ⇒ absent-because-never-coming ⇒ stop. Confirmed
against a merged PR of the same day, whose rollup carries `test` and whose only difference was that
its shards had finished. **Never conclude "never reported" from the aggregate alone** — an absence is
not a verdict until you have looked at what produces it, which is §0's table one more time.

✅ **`tools/land-pr.mjs` ALREADY GETS THIS RIGHT — cite it rather than re-deriving it.** Read before
writing this section, and the trap it documents is one the toolchain met and fixed on **#1293**, where
`suite (shard 1/6)` was pending, is not itself required, so `requiredPending` was 0 — and the tool fell
through to `merge` on a PR whose required `test` had never reported. Its `decide` now carries **both**
branches, and the discriminator it uses is broader than the shard-specific one above: *anything*
pending ⇒ the absent context is **LATE** (`wait`); nothing pending ⇒ **never coming** (`stuck`). It
also guards the failure mode one level up — an **unreadable** snapshot (a GraphQL TLS timeout on #1183)
returns `wait`, not `stuck`, because a failed measurement is not an empty result.

So this section is a note for **humans reading a rollup by eye**, which is where the misreading actually
happens; the tool is not exposed to it. Two independent confirmations, both measurements rather than
agreement: a peer's `land-pr` logs on two PRs today (`-> wait (… required context(s) not yet reported:
test)` at 18:48, `MERGED` at 18:52), and the `decide` source itself.

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
