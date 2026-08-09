<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-08-09 (the denominator question is ANSWERED and owner-ratified — §5, §8, §9. Its one open box, the parse-family probe, was closed by `CLOCK-PARSE-EQUIVALENCE-2026-08-09-BRIEF.md`: **8 survivors, not the 14 §6 claims, and 0 killable.**) · **Folded-into:** `MUTATION-PROGRAM-2026-08-09-BRIEF.md` · **Created:** 2026-08-04 · **Follows:** `TEST-COVERAGE-FOLLOWUPS-II-2026-07-17-BRIEF.md` · **Affects:** `tools/mutate.mjs`, `tools/mutate-triage.mjs`, `tests/dex-tests.js`, the 90 % target

> ⚠️ **Read `MUTATION-PROGRAM-2026-08-09-BRIEF.md` for the live programme.** This brief remains the
> authoritative *record* of how the denominator was measured and ratified, and of the JS (§8) and
> Python (§9) classification mechanisms. What it does **not** record is that the mechanism was fed
> once and never again: `tools/mutate-equivalence.json` still carries only this brief's three
> `real-gap` entries, while ~83 measured classifications sit in prose — see the successor's §2.
> `Folded-into:` is deliberately not `Superseded-by:`; that field is strictly 1:1 and this is a 4→1
> fold (successor §0).

# 80 % of `clock.js`'s surviving mutants cannot be killed — the target is wrong, not the suite

> ## ✅ RESOLVED 2026-08-05 — the ceiling is **81.9 % raw / 100 % distinguishable**, measured
>
> Six full sweeps (~10 h of wall time) took `clock.js` from **73.2 % → 81.9 %**, and **every one of the
> 23 remaining survivors is now classified**. The projection made after wave 5 — *"one more probe over
> the 13 unclassified at 21.2 % ⇒ ~3 killable ⇒ 104/127 = 81.9 % raw, then 100 % distinguishable"* —
> landed on the exact number.
>
> | wave | killed | rate | survivors |
> |---|---|---|---|
> | w1 (scoped) | 93/127 | 73.2 % | 34 |
> | w2 (full) | 94/127 | 74.0 % | 33 |
> | w4 (full) | 97/127 | 76.4 % | 30 |
> | w5 (full) | 101/127 | 79.5 % | 26 |
> | **w6 (full)** | **104/127** | **81.9 %** | **23** |
>
> ### ⚠️ CORRECTED 2026-08-06 — every figure in the table above is inflated; do not quote them
>
> The table was measured with a `mutate.mjs` that had two defects, both fixed by **#982** the day after
> this block was written, and both in the flattering direction:
>
> 1. **The numerator counted mutants that never ran.** Every non-zero exit scored KILLED, so an
>    unparseable mutant was indistinguishable from one a test caught — *"5 of clock.js's 104 kills never
>    ran"*. w6's **104** is therefore ~**99** real kills.
> 2. **The denominator was four mutants too wide.** Generation itself was producing malformed text —
>    `win >` became `win >=> 1` — and #982 records *"four such mutants were generated on `clock.js`"*.
>    That, not any edit to `clock.js` (byte-identical since 2026-08-03), is why the surface reads
>    **127** here and **123** in `CLOCK-MUTATION-AUDIT` §7.6 before it and in every run after it.
>
> **Re-measured 2026-08-06 on `HEAD f5f6e4d8`, two independent sweeps:**
>
> | run | killed | invalid | survivors | honest rate `killed/(tested−invalid)` |
> |---|---|---|---|---|
> | full (`--jobs 20`) | 98 | 5 | 19 | **98/117 = 83.8 %** |
> | scoped (`--jobs 16`) | 97 | 5 | 20 | **97/117 = 82.9 %** |
>
> The *rate* survives (~82–84 %); the absolute counts do not. **`invalid` is deterministically 5**, not
> the 1 assumed elsewhere — 2 unparseable (`L147`'s `/^\d{10,0}$/`, `L294`) and 2 non-terminating
> (`L211`'s `t += 0`, `L390`'s `while (hi2 - lo2 >= 1)`), which time out with no assertion output and so
> are INVALID under #982's rule. Both sweeps landed on exactly 5 despite different scope and job counts,
> which is what rules out contention.
>
> ### Wave 9 — the scoped-vs-full gap is closed
>
> §1 recorded that the unfiltered run found **exactly one** kill the scoped run missed:
> `clock.js:120 [cmp > → >=]`. That was the whole accuracy cost of the group filter on this module, and
> it is now killed from *inside* the `clock` tag, so scoped and full agree for the first time.
>
> The mutant turns `ms > 999` into `ms >= 999`. The classification below is right that **`L120` is
> unreachable by construction** — but that applies to the `bool || → &&` mutant, which survives both
> sweeps. For `>=` the boundary is not unreachable at all: three fraction digits express exactly 0…999,
> so **999 is the largest value the grammar can produce**, and under the mutant a real stamp
> (`2026-08-05T23:15:42.999`, one millisecond before the second rolls) is refused as out of range.
> Pinned by `clock.js — wave 9: the millisecond band is closed at both ends`, written as the contract
> (a closed band contains both its endpoints) and verified RED-under-mutant then GREEN-restored.
>
> **Standing: 97/117 = 82.9 % raw, 100 % distinguishable — 1 survivor killed, 19 classified.**
>
> **The 23, all classified — nothing left unexamined:**
>
> | category | n | why it cannot be killed by a test |
> |---|---|---|
> | no distinguishing input | 15 | `hostAxis` clamps, `correctionAt` endpoints, `L78`/`L138`/`L198` guards — ties where the mutated operator cannot change the result |
> | equivalent — the regex guarantees the input | 3 | `L45` ×2 and `L147`: `parseInt(s, 10) → parseInt(s, 0)`; radix 0 auto-detects base 10 for `/^\d+$/` |
> | equivalent — over-determined validation | 2 | `L118`'s three redundant `!==` clauses: disabling any one leaves the others to catch Feb 30 |
> | unreachable by construction | 1 | `L120` `ms > 999` — the ISO regex captures only 3 fraction digits, so no accepted input can violate it |
> | environmental | 2 | `L414`, the IIFE root selection |
>
> **The killable-fraction per probe round proved stable at ~21 %** — 3/15 (wave 2), 4/18 (wave 5),
> 3/13 (wave 6, of which one target turned out not to be a survivor at all). Three different functions,
> three different batteries.
>
> ### The three lessons that cost the most time
>
> 1. **A battery that does not reach the code reports "equivalent".** Wave 5's battery fed `resolveDMY`
>    bare dates like `'12/08/2026'`; it only matches FULL vendor stamps, so every mutant there read as
>    equivalent *without the code executing*. Two real survivors (`L93`/`L94`) were missed for a whole
>    wave. This is the failure mode that would make the entire method dishonest.
> 2. **Probe the mutant that ACTUALLY survived, not one like it.** `L120` has seven `||`s and `L45` has
>    three numbers; hand-editing the line tests a different occurrence than the recorded survivor. This
>    produced one false "equivalent" (`L120`) and one wasted test (`L45 *60`, whose target was never
>    surviving) — the sole reason wave 6 predicted 105 and delivered 104. **Use the survivor's recorded
>    `after` text.**
> 3. **Writing the test is not the verification.** Three tests looked correct and killed nothing until
>    re-applied against their mutant: the `n=3` interpolation geometry (window covered the whole
>    series), and the `L211` roll boundary (`prevTMs` a second off the exact `t + slack` point).
>
> ### What this means for the target
> **90 % raw is unreachable and no number of waves changes that.** 104/127 is the ceiling with the
> current operator set; the remaining 18 % would require editing production code — weakening redundant
> validation, deleting defensive guards — purely to score better. §5's proposal stands, now measured:
> report `killed / distinguishable`, which is **100 %**.

`clock.js` sits at **74 %** mutation kill rate and the standing goal is 90 %. This brief reports what
happened when the remaining 26 % was actually examined instead of estimated, and argues the goal should
be restated before any more tests are written against it.

---

## 1 · What was run

Two full sweeps of `clock.js`, 127 mutants each, on 24 cores.

| run | scope | jobs | killed | rate | survivors | wall time |
|---|---|---|---|---|---|---|
| **w1** | scoped to the `clock` group | 16 | 93/127 | 73 % | 34 | 80 m 34 s |
| **w2** | **unfiltered — full suite per mutant** | 20 | 94/127 | **74 %** | 33 | 107 m 58 s |

**The unfiltered run found exactly ONE more kill** — `clock.js:120 [cmp > → >=]` — for 34 % more wall
time, and there were **zero** mutants the scoped run killed that the full suite missed. So the group
filter costs **1 mutant of accuracy out of 127** on this module. Scoped is the right default here; that
was previously assumed and is now measured. It may not generalise — `clock.js` is the *least* likely
module to have its killing tests outside its own group, since it is inlined into every bundle and its
group is 43 of 376.

## 2 · Where the survivors are

Grouped by enclosing function (`tools/mutate-triage.mjs --report`), the 33 survivors are not 33
problems — they are six functions, and two hold half:

| function | survivors | character |
|---|---|---|
| **`hostAxis`** | **10** | every one a loop bound or window clamp (`<`→`<=`, `>`→`>=`) |
| **`correctionAt`** | **7** | interpolation endpoints + the `!(dx > 0)` guard |
| `parseTimestamp` | 5 | `&&`→`\|\|`, `num`→0 |
| `_ckMk` | 4 | 3× `\|\|`→`&&` on the calendar round-trip |
| `resolveDMY` | 3 | loop/threshold bounds |
| `_ckP2` | 2 | |

## 3 · The finding: only 3 of those 15 can be killed by ANY input

Rather than write tests and hope, each of the 15 `hostAxis`/`correctionAt` survivors was probed for a
**distinguishing input**: load original and mutated `clock.js` in separate realms, run both through a
battery — anchor geometries n=2/3/4/11/41/60, flat, tied, zero-span, negative drift × window
0/1/2/3/99 × `correctionAt` at 11 offsets — and diff the outputs.

**Twelve of fifteen produced byte-identical output on every input.** The three that did not:

| mutant | distinguishing input | what it breaks |
|---|---|---|
| `L284 opts.window > 0` → `>=` | `{window: 0}` | zero is accepted as a window ⇒ `win >> 1` is 0 ⇒ smoothing collapses to a single point and the running median stops smoothing, silently |
| `L325 span > 0` → `>=` | all anchors at one `devMs` | divide-by-zero ⇒ `ppm` NaN **and `ok` flips false**, so a degenerate input becomes a refusal for the wrong reason |
| `L396 !(dx > 0)` → drop `!` | `correctionAt` mid-interval | the guard fires on the NORMAL case ⇒ interpolation skipped, every mid-interval query snaps to the left anchor |

The other twelve are ties and clamps: `if (lo < 0) lo = 0` mutated to `<=` still assigns 0 when `lo` is
0; `if (st > maxStep)` mutated to `>=` cannot change a maximum on a tie; `for (i < len)` mutated to
`<=` reads one past the end into a `if (!a) continue` guard that already handles it. **The mutated
operator cannot change the result.** These are textbook *equivalent mutants*.

> **Stated precisely, because the distinction matters:** the battery found **no distinguishing input**.
> That is strong evidence of equivalence, not a proof — a proof needs an argument about the whole input
> domain, and the honest label is "no distinguishing input found under a battery of N shapes". Two of
> the twelve (`L386`, `L387`, the `correctionAt` endpoint comparisons) are the ones most likely to be
> genuinely killable by an input the battery lacks, since a query landing exactly on an anchor is a
> real boundary a caller could hit.

## 4 · What this means for the 90 % target

If ~80 % of the surviving population in the two largest clusters is equivalent, then the reachable
ceiling on `clock.js` is roughly:

```
94 killed + 3 newly killable = 97 of 127  ≈  76 %
```

**not 90 %.** Getting from 76 % to 90 % would require killing ~18 mutants that no input distinguishes —
which cannot be done by writing tests, only by *changing the source* so the mutated operator becomes
observable. That is refactoring production code to satisfy a metric, and it is the wrong trade.

`tools/mutate.mjs`'s own header already says this: *"A surviving mutant is proof that the SUITE cannot
see a change there"*, not proof of a bug, and *"some survivors are legitimately untestable."* The 90 %
figure was adopted without reconciling it against that sentence.

## 5 · RATIFIED 2026-08-08 (owner) — change the denominator, not the tests

> **THE TARGET IS NOW: 90 % of DISTINGUISHABLE mutants killed, and every non-distinguishable one
> classified.** Owner call, made 2026-08-08, on the terms this section proposed. The raw
> `killed / tested` rate is still printed beside it and is still the number a reader should sanity-check
> against — it is no longer the bar.
>
> **What makes the restatement safe rather than a lowered bar** is that it stopped being a claim and
> became data on the same day (§8): nothing leaves the denominator without a named entry, a recorded
> probe, and a tool that shouts REFUTED the moment a mutant it excused is killed. A target measured
> against a classification nobody can audit would be worse than an unreachable one.

Replace **"90 % of mutants killed"** with **"90 % of DISTINGUISHABLE mutants killed, and every
non-distinguishable one classified"**. Concretely:

- a survivor is triaged into **real gap** (write the test) · **no distinguishing input found**
  (record the battery that failed to find one) · **untestable by design** (a log string, a defensive
  branch that cannot be reached);
- the reported metric is `killed / (tested − classified-equivalent)`;
- the classification is committed next to the module, so the next sweep does not re-litigate it.

On `clock.js` that reads **97 / (127 − 12) ≈ 84 %** today, and the remaining work is a finite list of
named survivors rather than an open-ended chase.

## 6 · Done when

- [x] Two full sweeps run and compared; the scoped-vs-unfiltered cost measured (§1).
- [x] Survivors grouped by function; the two dominant clusters identified (§2).
- [x] Every survivor in those clusters probed for a distinguishing input (§3).
- [x] The three killable ones pinned by assertions that each fail on their own mutant —
      verified by re-applying each mutant (1, 4 and 4 assertions red respectively).
- [x] **The equivalence classification committed in a form the tooling reads** — DONE 2026-08-08,
      see §8. `tools/mutate-equivalence.json` + `classifySurvivors`; a run now reports
      `killed / distinguishable` **beside** `killed / tested`, never instead of it.
- [ ] `parseTimestamp` · `_ckMk` · `resolveDMY` · `_ckP2` (14 survivors) probed the same way — this
      brief covers only the 15 in `hostAxis`/`correctionAt`.
- [x] **Owner call — ANSWERED 2026-08-08: restated per §5.** The target is *90 % of DISTINGUISHABLE
      mutants killed, and every non-distinguishable one classified*. On the raw denominator the answer
      was "unreachable"; on this one it is a finite, named list of survivors to probe.

## 7 · Notes on the tooling, recorded because they cost time

- **`--report` silently found nothing** on a run carrying 34 survivors: `mutate.mjs --json` emits
  NDJSON, one object per file, and the reader assumed a `{files:[…]}` wrapper. Fixed (#913); it now
  refuses loudly rather than reporting "nothing to triage".
- **The ETA window is still too narrow.** It trails 12 completions, but a 20-job pool finishes in
  bursts of 20, so the window can sit entirely inside one burst. Projections drifted 244 → 135 min on
  a run that took 108. It should be `max(2 × jobs, 12)`. **Open.**
- **A partial run is not a trend.** At 60/127 the unfiltered sweep showed 10 survivors where the
  scoped rate predicted ~16, and that was read as "unfiltered is finding meaningfully more". The full
  population came back 33 vs 34. Do not extrapolate a sweep before it finishes.


---

## 8 · EXECUTED 2026-08-08 — the classification is data, and it cannot flatter a rate

### 8.1 · What landed

`tools/mutate-equivalence.json`, in the shape `tools/mutate-canaries.json` already established, matched
on **`(line, op, before)`** — the same key `findCanary` uses. `after` is recorded for a reader and
deliberately NOT part of the key, so changing an operator's output text cannot silently orphan an entry.

`mutate.mjs` gains `loadEquivalence()` + `classifySurvivors()` (both exported, both pure) and every
per-file result now carries an `equivalence` block: `{ excused, realGap, unclassified, refuted,
orphaned, distinguishable }`. The console line prints the distinguishable rate **beside** the raw one:

```
generated 123, tested 118 → killed 98, survived 19, invalid 5   [83 % killed]
equivalence: 12 excused, 3 real-gap, 4 UNCLASSIFIED   [93 % of 106 distinguishable]
```

Both denominators stay visible on purpose. **The gap between them is this brief's entire argument** —
hiding the raw number would make §4's case unauditable.

### 8.2 · The constraint came from the tool's own header, and it is honoured

`mutate.mjs` had already scoped this work and set its acceptance condition:

> *"Feeding it in as an allowlist is the obvious follow-up; until then, expect to argue with the gate
> occasionally and **prefer that over a gate that silently excuses whatever it cannot kill**."*

So this is not an allowlist. Three states are reported loudly, and they exist specifically to stop the
mechanism becoming the thing that header warns about:

| state | meaning | why it must shout |
|---|---|---|
| **REFUTED** | an entry claims equivalence, and that mutant was **KILLED** | the classification is WRONG — a distinguishing input exists after all. This is the ONLY way a stale file could hide a real gap. The fix is the entry, **never** the test that killed it. |
| **ORPHANED** | an entry matches no generated mutant (line moved, code changed) | excluded from every count until re-verified, so a stale entry can never shrink a denominator |
| **UNCLASSIFIED** | a survivor with no entry | counted and named. **Silence is never equivalence.** |

And `real-gap` entries **stay in** the distinguishable denominator. They are debt; a classification file
is not a place to launder debt into a better number. That property is pinned by its own selftest.

### 8.3 · Gated by known answer, because the classifier is pure

Eight selftests in `mutate.mjs --selftest`, exercising every branch: an excusing class that survived
(excused), an excusing class that was killed (**REFUTED**), a `real-gap` survivor (not excused), an
entry matching nothing (**ORPHANED**), a survivor with no entry (**UNCLASSIFIED**, and it names which),
the anti-laundering property, and the opt-in property — an empty classification changes nothing.

They are known-answer rather than sweep-derived on purpose: the classifier is a pure function, and
pinning it to a 90-minute mutation run would make it untestable in practice.

### 8.4 · What is seeded, and what is deliberately NOT

The file currently carries **only the three `real-gap` entries** from §3 — the ones this brief documents
with a specific distinguishing input (`L284` `{window: 0}`, `L325` all-anchors-at-one-devMs, `L396`
mid-interval `correctionAt`). All three are now killed, so they contribute nothing to any count today;
they are kept as the record that a distinguishing input EXISTS, which matters the moment a refactor
makes one survive again.

**The twelve equivalent ones are NOT seeded, and that is a decision rather than an omission.** §3 counts
them but names only `L386`/`L387` individually — and `L386` has since become the killed canary. Writing
twelve entries from a prose summary would be inventing data of exactly the kind this mechanism exists to
replace. The tool reports every unprobed survivor as `UNCLASSIFIED` by name, so the remaining work is a
list the tool prints rather than a claim in a brief.

## 9 · EXECUTED 2026-08-09 — the Python gate had the same problem and none of the mechanism

§8 solved this for `tools/mutate.mjs`. **`capture-host/tools/mutate_diff.py` — a second, independent
mutation gate, on CI, blocking — had no equivalence concept at all**, so its only two outcomes were
"killed" and "fails forever". Its own header already names the cost of the second one: *"A gate that
runs when it has nothing to say trains people to ignore it."*

**How it surfaced.** The diff-scoped gate on PR #1090 reported **6 survivors** in
`probe_verity_survey._session_matches` — the date-comparison arm that PR added. The PR merged anyway
(the job is advisory), which is the failure mode in miniature: a red nobody can clear becomes a red
nobody reads.

### 9.1 · Five were real gaps, and the tests that "covered" the change did not cover its edges

The #1090 tests pinned the *behaviour* (wrong day rejected, midnight accepted) and left the arm's own
boundaries unexamined, so a weakened predicate still passed. Each kill below was verified by
**re-applying that exact mutant** and watching the suite go red — a kill claimed from reading the code
is the thing this repo keeps rediscovering it cannot rely on.

| mutant | mutation | why the existing tests could not see it | the killing input |
|---|---|---|---|
| 27 | `len(parts) >= 3` → `> 3` | every fixture had FIVE parts | `20260701_R_120059` — a three-part name, wrong day |
| 28 | `len(parts) >= 3` → `>= 4` | same | same |
| 32 | `parts[-3]` → `parts[-4]` | every fixture had a DIGIT at `[-4]` (`U_0_…`), so both indices agreed | `U_x_20260701_R_120059` |
| 51 | `< 180` → `<= 180` | no fixture sat on the boundary | exactly 180 s ⇒ False |
| 52 | `< 180` → `< 181` | same | same |

The shape is worth naming: **all five are edges of a predicate the same PR introduced.** Writing tests
from the behaviour you intended, rather than from the branches you wrote, leaves exactly this residue.

### 9.2 · The sixth is equivalent, and that is now a record rather than an argument

`if not (len(tail) == 6 and tail.isdigit())` → `or`. The weakened guard admits exactly two extra
shapes — `len==6` but not all digits, and all digits but `len!=6` — and **both then fail
`strptime(tail, "%H%M%S")` and return `False` down the `except ValueError` path**, which is the value
the guard would have returned. The guard is a fast path, not a semantic gate.

Probed over **133,495 directory names** (26,699 tails of length 0–8 over digits + letters + `" -:."`,
plus hand-picked adversarial ones, crossed with five prefix shapes): **zero behavioural differences.**
That is strong evidence, not proof, and the entry says so — `probe` records what was actually run, so
the claim can be re-checked or widened rather than re-litigated.

### 9.3 · Keyed on the DIFF, and the run proved why

`capture-host/tools/mutate-equivalence.json` mirrors the root file's rules, with one deliberate
difference: mutmut names mutants `module.x_func__mutmut_N`, and **N renumbers whenever anything earlier
in the function changes.** An entry keyed on it would keep matching while silently pointing at a
different mutation.

**This was not hypothetical.** The same tail-guard mutation is `__mutmut_12` in the CI run on #1090 and
`__mutmut_6` in the local re-run — same source, same tool, different index. The diff key
(`- <old line> | + <new line>`, whitespace-normalised) matched across the renumbering.

### 9.4 · The three loud states, and they were made to fire

Ported verbatim from §8.2's constraint — an entry excuses a mutant only while it is BOTH still
generated AND still surviving:

- **REFUTED** — the entry claims equivalence and the mutant was KILLED. **Fails the gate.** It is the
  only route by which a stale file could hide a real gap. Detecting it costs one `mutmut show` per
  killed mutant, so that cost is paid *only* for modules the equivalence file actually claims; a PR
  with no claims runs exactly as fast as before.
- **ORPHANED** — matches no generated mutant (the line moved). Excluded from every count, so a stale
  entry shrinks nothing.
- **unclassified** — survivors nobody probed. Fail the gate exactly as before.

`--selftest` pins the classifier's five outcomes and `diff_key`'s normalisation without running a
sweep, and all three states were exercised end-to-end against the real #1090 diff:

```
A · key pointing at nothing             → ORPHANED + 1 unclassified   → exit 1
B · key claiming a mutant the tests kill → REFUTED                     → exit 1
C · restored                            → "every mutant on the changed functions was killed
                                           (1 recorded as equivalent)" → exit 0
```

**The negative cases were run, not reasoned about.** A gate that decides what may be ignored is the
last place to accept a green nobody has seen fail — and both of the following were found by running
them rather than by reading the code.

### 9.6 · Two failures inside the verification itself, recorded because they are the house pattern

**(a) `mutmut results` does not list killed mutants at all.** The first REFUTED implementation scanned
its output for `": killed"`. That token never appears: the command reports only `survived` and
`not checked`, and a killed mutant is simply absent. So the check ran on every PR, matched nothing, and
would have reported "no refuted entries" forever — a check that reports success about something it
never examined, which is the same sentence as §9's opening problem.

The generated set now comes from mutmut's own mutants file, where every mutant is a
`def x_<func>__mutmut_N(`; `mutmut show` renders killed ones normally. Confirmed by counting: **52
generated defs** for `_session_matches`, against the 2 lines `results` prints.

**(b) The negative-test harness reported `EXIT=0` for a gate that had correctly failed.** It read
`${PIPESTATUS[0]}` after calling a shell *function* — which is the function's own status, i.e. the
trailing `grep`'s, not the python inside it. Test A printed a correct ORPHANED diagnosis and a green
exit in the same breath. Fixed by capturing `$?` of the command itself before any pipe, exactly as
CLAUDE.md §4/§4b prescribes; A then reported exit 1 as it should.

Neither bug was in the gate. Both were in the thing checking the gate, which is the harder place to
notice one and the reason the three cases are written down here as commands rather than as a claim
that they passed.

### 9.5 · A drive-by that the workflow itself caused

`.gitignore` had `.venv/` — **with a trailing slash, which matches directories only.** Running the
capture-host tests from a git worktree means symlinking the venv in (`ln -s …/capture-host/.venv`), the
exact workflow CLAUDE.md §1 prescribes — and a *symlink* named `.venv` was therefore **not ignored**,
showing as untracked in a shared checkout where §2 spends a page on what a blanket stage does to those.
Both files now carry the slashless form as well.
