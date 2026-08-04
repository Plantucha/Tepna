<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-08-04 · **Follows:** `TEST-COVERAGE-FOLLOWUPS-II-2026-07-17-BRIEF.md` · **Affects:** `tools/mutate.mjs`, `tools/mutate-triage.mjs`, `tests/dex-tests.js`, the 90 % target

# 80 % of `clock.js`'s surviving mutants cannot be killed — the target is wrong, not the suite

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

## 5 · Proposed: change the denominator, not the tests

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
- [ ] The equivalence classification committed in a form the tooling reads, so a sweep can report
      `killed / distinguishable` instead of `killed / tested`.
- [ ] `parseTimestamp` · `_ckMk` · `resolveDMY` · `_ckP2` (14 survivors) probed the same way — this
      brief covers only the 15 in `hostAxis`/`correctionAt`.
- [ ] **Owner call:** is the 90 % target restated per §5, or kept as-is on the raw denominator? Every
      further wave depends on the answer, and on the raw denominator the answer is "unreachable".

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
