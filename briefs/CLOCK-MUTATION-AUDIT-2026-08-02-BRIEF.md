<!--
  CLOCK-MUTATION-AUDIT-2026-08-02-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-02 (**all five §5 items executed — see §7.** The mask is regex-aware; the three documented guards are gated and measured at zero survivors; the exhaustive re-run is **86/123 = 70 %** with a valid **59 % → 70 %** like-for-like delta; both zero-kill modules are diagnosed and asserted; the 40 "unmeasurable" files were 7 tags. Follow-up: `CLOCK-AXIS-AND-RENDER-SURFACE-FOLLOWUPS-2026-08-02-BRIEF.md`.) · **Created:** 2026-08-02 · **Follows:** `TOOL-INVOCABILITY-SWEEP-2026-08-02-BRIEF.md` §6 · **Tool:** `tools/mutate.mjs`

# The Clock Contract is the least-tested module in the suite — 41 % of mutations go unnoticed

`CLAUDE.md` opens the Clock Contract with **"non-negotiable — every app + every future node must obey"**.
It is the invariant every node inherits and the one a violation of is hardest to see downstream. It is
also, measured, **the weakest module in the fleet**.

## 1 · The measurement

`node tools/mutate.mjs --file clock.js --limit 200` — **exhaustive**, all 81 mutants, 40 min wall.

| | |
|---|---|
| mutants generated | 81 (every one tested; 0 invalid) |
| killed | **31** |
| survived | 50 → **6 were comment noise** (§4) |
| **adjusted kill rate** | **31 / 75 = 41 %** |

For context, from the 71-file roster sweep in `TOOL-INVOCABILITY-SWEEP` §6 (12-mutant samples):

```
100 %  pulsedex-dsp · dex-ingest · hrvdex-dsp · ppgdex-app · nsrr-adapter · overdex-walk
 91 %  oxydex-dsp        83 %  ppgdex-dsp        66 %  integrator-tch
 58 %  integrator-dsp    50 %  ecgdex-dsp        41 %  clock.js  ← the spine
```

**There is a mechanism, and it is uncomfortable.** `clock.js` is also the most EXPENSIVE module to test
— one `--group=clock` run takes **191 s**, because clock is loaded by everything and its tag selects
sixteen heavy groups. Expensive-to-test correlates with under-tested, which is exactly backwards from
what you would want of a spine. No coverage report would ever show this: coverage of `clock.js` is
necessarily near-total, because every test in the suite loads it. Coverage asks *was this executed*;
this asks *would anyone notice if it were wrong*.

## 2 · The survivors that matter — two are documented invariants

### 2.1 §3's locked-order contradiction check is essentially untested

*(This section originally called `clock.js:56` "§2.7's component-range validation". That was wrong and is
corrected here: §2.7's validator is `_ckMk` (line 113), which round-trips the date through `Date.UTC`
and IS gated. Line 56 is §3's FILE-LEVEL LOCK — the check that refuses a row the proven order cannot
explain. The mutants and the argument stand; only the section reference was mislabelled.)*

§3's lock exists so a single anomalous row cannot flip a file's date order mid-way. `_ckDMY`'s own
doc-comment records what happens when it fails: *"a proven-MDY O2Ring night 2026-06-12 → 2026-12-06,
with the date, `t0Ms`, `exportName()`, the crossnight axis and the Integrator's date join all
confidently wrong."* The whole guard is one line (`clock.js:56`):

```js
return lmo >= 1 && lmo <= 12 && ld >= 1 && ld <= 31 ? { d: ld, mo: lmo } : null;
```

**Seven mutants of that single line survive** — every boundary (`>=`→`>`, `<=`→`<` on both month and
day) and three of the `&&`→`||` rewrites. So the suite did not check that month 0 is refused, that
month 13 is refused, that day 0 or day 32 is refused, or that the conjunction is a conjunction.

### 2.2 §3's DMY/MDY disambiguation rule

§3: *"Any row with day-component > 12 ⇒ file is unambiguous; lock that order for the whole file."*
At `clock.js:59`, `if (b > 12) return { d: b, mo: a };` — the `>`→`>=` mutant survives, so nothing
distinguishes "12" from "13" at the exact boundary the rule is written around. A file whose maximum
day-component is exactly 12 is the ambiguous case; one at 13 is the decisive one.

### 2.3 The numeric-epoch plausibility guard (§2.1)

`clock.js:37-38`:
```js
if (n < 1e11) n = n * 1000;              // 10-digit (or smaller) → seconds → ms
if (n < 1e11 || n > 4e12) return null;   // implausible epoch range
```
Both boundaries and the `||`→`&&` survive. This is the branch that decides whether a bare number is a
plausible instant at all — the first line of defence against a serial number being read as a date,
which is the exact defect `ENGINE-VERIFICATION` §1.1 found in `fnameStampMs`.

### 2.4 The rest

The midnight-roll monotonic loop (§2.5, `while (t < opts.prevTMs - CK_ROLL_SLACK_MS)`), the
`need ≥3 host anchors` guard, the `CK_AXIS_MAX_PPM` sanity bound, and the axis binary search
(`clock.js:337-347`) all carry surviving boundary mutants. Loop-bound survivors (`i < n` → `i <= n`)
are the usual cheap-to-dismiss class and are NOT triaged here.

## 3 · What this does NOT say

- **Not that clock.js is buggy.** Every surviving mutant is a statement about the SUITE, not the code.
  The Clock Contract's behaviour may well be correct; nothing currently proves it.
- **Not that 41 % is comparable across modules.** The roster figures are 12-mutant samples; this one is
  exhaustive. A sample of 12 from `oxydex-dsp`'s 2665 has wide error bars. Only `clock.js` has been
  measured properly, and it is the module with the fewest mutants to measure (81).
- **Not a coverage claim.** These are orthogonal: `clock.js` almost certainly has excellent line
  coverage precisely because everything loads it.

## 4 · A DEFECT IN THE TOOL, found by this run

**6 of the 50 survivors mutate a comment** — all on `clock.js:131`, inside a `/* … */` block. The
`codeMask()` scanner added in PR #694 should have excluded them. It desynchronises at **line 81**:

```js
s = s.trim().replace(/^["']|["']$/g, '');
```

A **regex literal containing quote characters**. The scanner sees `/`, decides it is neither `//` nor
`/*`, stays in code state — then meets `"` and enters string state, and every subsequent quote flips it
wrongly for the remainder of the file. The tool's own header already warns it "does not know about
regex literals, which are rare in these DSPs"; in a timestamp parser they are not rare, and `clock.js`
is the worst possible case for that assumption.

**Consequence for this brief:** the raw 38 % is contaminated; 41 % is the figure after excluding the
six. Both are reported so the correction is visible rather than laundered. **Consequence for the tool:**
the mask needs to be regex-aware, or to detect desynchronisation and refuse to report rather than
report noise. Tracked as the first item in §5.

## 5 · Recommended, in order

1. **Make `codeMask()` regex-aware** (or fail loudly on desync). Until then, every `--file` result on a
   regex-heavy module needs the comment-survivor check this brief did by hand.
2. **Close §2.1's three documented invariants** — component-range refusal (§2.7), the DMY/MDY `> 12`
   boundary (§3), and the epoch plausibility band (§2.1). These are the highest-value tests in the repo
   by the plain argument that `CLAUDE.md` calls them non-negotiable and nothing checks them.
3. **Re-run exhaustively after (2)** and record the new rate here. The point of a mutation audit is the
   delta, not the snapshot.
4. **The two zero-kill modules** from the roster sweep — `cohort-regression.js` (0/12, 65 mutants) and
   `cpapdex-render.js` (0/12, 319 mutants) — have a tagged group that does not exercise them at all.
5. **40 of 111 shipped files have no tagged group**, so the tool reports `NO GROUPS` rather than scoring
   them. Unmeasured is not untested, but nobody currently knows which of the 40 are which.

## 6 · Done when

- [x] `codeMask()` handles regex literals, or detects desync and refuses; verified on `clock.js`. — §7.1 (PR #713).
- [x] §2.7 component-range, §3 DMY boundary and §2.1 epoch-band mutants are killed by new assertions,
      each verified by re-applying the exact mutant. — §7.2 (PR #713); **§7.6 confirms zero survivors on all five guard lines.**
- [x] `clock.js` re-run exhaustively; the before/after rate recorded in this brief. — **§7.6: 86/123 = 70 %**,
      and a valid like-for-like pair after all: **59 % → 70 %, +13 mutants**, on a byte-identical `clock.js`
      and the same 123 mutants, differing by exactly the 19 guard assertions.
- [x] The two zero-kill modules diagnosed (no test, or mis-tagged test). — **§7.4: neither.** Both had a
      real, correctly-tagged group aimed at a sliver of the file (`olsR2` = 5 of 65 mutants;
      `renderReviewView` = 0 of 319, while 76 % sat behind already-exported builders). Now 11/65 and
      61/319 exhaustive.
- [x] A note here on whether the 40 untagged files are untested or merely unselectable. — `TOOL-INVOCABILITY-SWEEP` §7 (PR #717): 7 mis-tagged · 4 other-harness · 28 DOM-bound · **0 genuine gaps**.


## 7 · EXECUTED 2026-08-02 — §5 items 1 and 2

### 7.1 · The mask is regex-aware, and the old numbers were wrong in BOTH directions

`codeMask()` now lexes regex literals: a `/` opens one only in expression position (decided by the last
significant character — after an identifier, number, `)` or `]` it is division), and inside one, `/`
terminates only outside a character class, with backslash escapes honoured.

The correction is bigger than "six comment survivors go away". Mutant generation on `clock.js` moved
**81 → 123**. The desync had marked large stretches of real code as *string*, so the audit was
**suppressing legitimate mutants** as well as inventing noise. The published 38 % rested on a
population that was wrong in both directions — which is why the re-run in §7.3 is the number that
counts, not a patch to the old one.

Pinned in `--selftest`: a regex containing both quote characters does not desync the scanner, the
comment *after* it is still protected, and a division slash is still division. Also added `--dry-run`,
which lists a module's mutants without running anything — proving "no mutant lands in a comment"
should not cost 40 minutes of suite execution.

### 7.2 · The three guards are gated (19 assertions, 2 groups)

`Clock Contract §2.1 · the numeric-epoch plausibility band` and `Clock Contract §3 · a locked DMY order
refuses the row it cannot explain`. Each guard is asserted as a **rejection AND its adjacent
boundary**, because a one-sided test kills the `||`→`&&` mutant and leaves every `<`→`<=` alive —
which is precisely the state the audit found.

Every survivor re-applied and confirmed killed:

```
§2.1  || → &&              → ✕ above the band → null      (got a fabricated instant)
§2.1  lower edge < → <=    → ✕ 1e11 is INSIDE the band
§2.1  upper edge > → >=    → ✕ 4e12 is INSIDE the band
§3    lock && → ||         → ✕ month 15 is a CONTRADICTION → null
§3    month >= 1 → > 1     → ✕ month 1 is valid
§3    day <= 31 → < 31     → ✕ day 31 is valid
§3    unlocked b > 12 → >= → ✕ b = 12 is still AMBIGUOUS
```

The last one is the sharpest: §3's rule is *"any row with day-component > 12"*, so 12 is the ambiguous
case and 13 the decisive one. The mutant lives entirely in the gap between them, and only asserting
both closes it.

### 7.3 · The re-run measured the WRONG TREE — a third tool defect, and the worst

The exhaustive re-run finished (123 mutants, 79 min) at **73/123 = 59 %** — and the number is **void**.
It listed as SURVIVORS the seven mutants §7.2 had just proven killed by hand.

The cause: `workerPool()` created each worker with `git worktree add --detach HEAD`. **HEAD**, not the
working tree. So every uncommitted change — including the tests written minutes earlier — was invisible
to the run. It fails in the worst possible way: silently, with a plausible number, **about the wrong
code**. A harness whose entire purpose is "can the suite see my change?" was answering about the last
commit.

Fixed: each fresh worker is now mirrored from the caller's dirty files (`git status --porcelain -z`,
covering modified and untracked alike, deletions applied as deletions). Verified directly rather than
inferred — a worker checked out at HEAD contains **0** occurrences of an uncommitted assertion; after
`syncDirty` it contains **1**.

**So the honest position on the delta:** the before-figure (41 %) and the after-figure (59 %) are
measured on different mutant populations (81 vs 123, after the mask fix) AND the after-figure was
computed against the pre-fix suite. Neither is a valid before/after pair, and inventing one from them
would be exactly the kind of laundered number this brief exists to object to. What IS established is
narrower and solid: **seven specific survivors, each re-applied and confirmed killed** (§7.2). The
authoritative exhaustive rate is owed one more run on a committed tree, and is left open in §6.

> **Amended by §7.6 — "void" was too strong, and this section's own verdict needed correcting.**
> The 73/123 run measured `HEAD`, i.e. the tree **without** the uncommitted guard assertions. That is
> the *wrong* answer to the question asked at the time ("how does the suite do WITH my new tests"), but
> it is the *right* answer to a different one: **how the suite did BEFORE them**. Because `clock.js` is
> byte-identical across every commit involved, that figure turns out to be usable as the before-leg
> after all. See §7.6.

### 7.4 · The two zero-kill modules — neither was untested, and neither was mis-tagged

§6 item 4 offered two explanations for a module that kills 0 of 12 sampled mutants: *no test*, or a
*mis-tagged* one. Both are wrong here, and the real answer is a third thing worth naming, because it is
the shape a coverage number cannot show you.

**`cohort-regression.js` — 65 mutants, 0/12.** The `cohort-regression` tag is accurate and its group
runs 20 real known-answer assertions. They cover `olsR2`, which is **5 of the file's 65 mutants**. A
12-mutant sample expects *one* to land inside the tested function, and an equivalent mutant there costs
nothing to miss. The group was never weak; it was aimed at one twenty-fifth of the file.

**`cpapdex-render.js` — 319 mutants, 0/12.** Same shape, larger. The §RN harness group drives
`renderReviewView` and asserts two substrings of it. But `renderReviewView` contains **zero** mutants —
it is pure composition — and the module exports **21** entry points, all pure, deterministic,
HTML-returning builders. Measured: **242 of the 319 mutants (76 %) sit inside functions the module was
already exporting.** The surface was reachable the entire time. Nothing was blocking it; nobody had
pointed a test at it.

So the third explanation, and the one that actually applied to both: **a real test, correctly tagged,
covering a sliver — with a tag that makes the whole file look gated.** This is precisely what the tag
sweep in §7 of `TOOL-INVOCABILITY-SWEEP` could not detect, because a tag records *which module a group
is about*, not *how much of it the group reaches*. It is also invisible to line coverage: `olsR2` is
100 %-covered, and so is the 8 % of the file it represents.

**What was done.** Both are now asserted through their existing exported surface:

| module | before | after | source change |
|---|---|---|---|
| `cohort-regression.js` | 0/12 sampled | **11/65 exhaustive** | one line — `matchRecall` joins `olsR2` on the namespace |
| `cpapdex-render.js` | 0/12 sampled | **61/319 exhaustive** | **none** — test-only |

`matchRecall(detTMs, truthTMs, loSec, hiSec)` is the other pure kernel in the cohort page: the greedy
one-to-one matcher whose output the page grades pass/fail against `TOL.desatRecallMin`. An unexercised
recall calculator deciding a green verdict is the house failure class, so it is pinned on the properties
that are each separately wrong in a recall-*inflating* direction — the one-to-one `used` set, the signed
asymmetric window (`d = det − truth`, not `|d|`), both inclusive edges, the seconds→ms conversion, and
empty-truth ⇒ `null` rather than a fabricated 1.0.

The CPAPDex group pins the severity **bands**, because that is where a silent mutation is clinically
loud — a widened cut paints a badly-controlled night green. Wherever two metrics differ *only* by their
band they are asserted on the **same input**, so a copy-paste between them cannot survive: 12 /hr must
read `bad` for central apnea and `warn` for obstructive (5,10 vs 5,15); 15 L/min must read `warn` as a
median and `ok` as a p95 (12,24 vs 18,24); 8 % must read `ok` for flow-limitation and `warn` for snoring
(10,25 vs 5,15). `sev()`'s polarity flag gets the same treatment in both directions at once — a good
night is AHI 3 `ok` *and* 6 h `ok`, which are opposite polarities, so dropping the `lower` flag from
either flips exactly one of them.

**Two assertions were written wrong and mutation found both** — worth recording, because in each case
the test passed and looked convincing:

- *An absent metric renders "—".* Asserted with `{}`, i.e. `undefined`. The real guard is
  `v == null || !isFinite(v)`, and deleting the `v == null` half still passes that test, because
  `isFinite(undefined)` is false. Only an **explicit `null`** exposes it — `isFinite(null)` is **true**,
  so a mutated `fnum` renders a missing AHI as **`0.00`, graded `ok`**: the most reassuring possible
  reading of no data, on the shape a JSON export actually carries.
- *One detection cannot match two truths.* Asserted with a 0.5 case that, by coincidence, **still reads
  0.5** when the inner `break` is deleted. The exposing case needs surplus unmatched detections: two
  detections around one truth, where a missing `break` returns a recall of **2.0**.

Both now carry the case that kills the mutant, with the coincidence written down next to them.

**The honest ceiling.** Of the 258 surviving CPAPDex mutants, **69 are canvas drawing** (`drawAhiByHour`,
`drawPressure`, `drawNightTrend`) and **39 are DOM-mutating** (`renderHistory`, `hydrate*`) — 108 that a
headless HTML-string harness cannot reach without a canvas stub or a jsdom, which is a different piece of
work. The remaining **150 are pure HTML builders that are still unasserted** (`heroCard` 25,
`cpapClinicalSummary` 20, `cpapEventTimeline` 17, `oximetryCard` 11, `crossCard` 11, …). 19 % is a floor
worth landing, not a finish line; the follow-up is mechanical and needs no source change.

**One incidental finding, not fixed here.** In `cpapClinicalSummary` the `else if (ahi != null)` fallback
is **unreachable by construction**: the preceding `if (ahi != null)` unconditionally pushes a finding, so
`findings.length` is non-zero whenever that condition could hold. Its "well controlled; leak and usage
within range" string can never render. It is dead, not wrong, and removing it is a render change owing a
re-bundle — recorded here rather than smuggled into a test-only PR.

**A second finding that BOUNDS the claim above, found while checking that nothing inlines the edited
file.** `cohort-runner.html:293` carries an **independent second implementation of `matchRecall`** — same
[−10 s, +60 s] window, same greedy one-to-one semantics, different code and a different return shape (an
object with `recall`/`precision`/`matched` versus a bare ratio). Neither is generated from the other; the
runner's copy is what actually drives the cohort, and `cohort-regression.js`'s copy is what the page
re-derives. So the assertions above gate **one of the two sites**, and the honest statement of coverage
is exactly that — not "the recall matcher is now gated".

The two are structurally different in a way that matters to the mutant this brief already recorded: the
runner tracks a `hit` index and commits *after* the inner loop (`if (hit >= 0) { usedDet.add(hit);
matched++; }`), so its one-to-one property is structural and cannot be broken by deleting a `break`. The
`cohort-regression.js` copy increments *inside* the loop and depends on the `break` for the same
guarantee — which is the weaker construction, and the one whose deletion returns a recall of 2.0.

This is the *cross-site agreement* class the suite already gates elsewhere by source scan (the DesSev
band scan, DA-II §2.2, on the same rationale: two sites grading the same number, with no executable entry
that spans both). The same treatment fits here — assert that both sites convert seconds→ms, test
`d >= lo && d <= hi` signed-and-inclusive, and carry a used-set guard — but it needs `cohort-runner.html`
and `cohort-regression.js` added to `readSources()`'s whitelist in **both** runners, which is a wider
change than this test-only unit and is deliberately left as the next step rather than folded in here.

### 7.5 · Wave 2 — and a CORRECTION to §7.4's ceiling, which understated the reachable surface

**§7.4's split was wrong.** It reported "150 pure HTML builders still unasserted; 108 canvas/DOM a headless
harness cannot reach", bucketing **`renderHistory` (29 survivors) and `renderNight`** as DOM-mutating. Both
are **pure** — each returns an HTML string and mutates nothing; only `hydrate`, `hydrateHistory` and
`_cpapInjectSelfIngestCSS` touch the DOM, and they carry **7** survivors between them, not 39. The honest
split of §7.4's 258 survivors is:

| | §7.4 said | actually |
|---|---|---|
| canvas drawing | 69 | 69 |
| DOM-mutating | 39 | **7** |
| reachable as HTML | 150 | **182** |

The reachable surface was a **third larger** than the number this brief published. Recorded here rather
than quietly amended, because the understated figure is exactly the kind of thing a later reader would
inherit as the ceiling and stop at.

The correction has a consequence: `renderNight` is exported and pure, and it is the **only** route to
`heroCard` (25 survivors — the largest single surviving function, and the node's headline clinical
verdict). `heroCard` is not on the export list, so §7.4 treated it as out of reach; through `renderNight`
it is not.

**Wave 2 result: 61/319 → 118/319 = 36 %**, still test-only, still no source change and no re-bundle.

What it pins, beyond more of the same bands:

- **`heroCard`'s four tiers**, on both sides of both edges (`< 5` well-controlled, `< 15` borderline). Each
  tier carries a *different clinical instruction* — "therapy is suppressing events effectively" versus "a
  pressure/fit review is warranted" — so a widened band does not merely mis-colour a number, it tells the
  reader to do the opposite thing. The tier string and its note are separate expressions, so both are
  asserted.
- **The compliance chip's 4 h threshold**, which is a *second, independent* copy of the adherence rule the
  clinical summary already applies. Both are now pinned inclusive at exactly 4 h.
- **The CA > OA chip**, which fires on strictly-greater: equal indices are not a warning.
- **`oximetryCard`'s two-polarity grid** — `odi` and `t90Pct` lower-better beside `spo2Nadir` and
  `spo2Mean` higher-better, in one tile row. That is precisely where a polarity slip hides, so a bad night
  and a good night are both asserted across all four.
- **The honest-absence branch**: no oximeter must render the "*not fabricated*" shield, and an oximetry
  block present but `available: false` must take the **same** branch rather than rendering zeros.
- **`cpapEventTimeline`'s chronology** (it sorts; the export order is not authoritative), the apnea
  **class** naming (central / obstructive / unclassified are not interchangeable, and an unclassified
  apnea is never guessed into a class), the per-impulse meta formats, and the 40-row cap's disclosure.

**Two more of my own assertions were wrong, and mutation found both again:**

- *The 40-row cap counts apnea **or** hypopnea.* Asserted with an all-apnea fixture, which still counts 30
  when the `|| e.impulse === 'hypopnea'` half is deleted. A disjunction needs both disjuncts present.
- *An off-mask gap attaches to its own session.* Asserted by counting gap rows — which cannot see
  `afterIdx === i` become `!== i`, because that still renders exactly one row, just under the **wrong
  session**. Position was the only distinguishing evidence.

That is four wrong-but-passing assertions across the two waves, all four found the same way. The pattern is
consistent enough to state plainly: **an assertion written from reading the code tends to encode the code's
shape rather than its contract**, and the cheapest correction is to re-apply the mutant it is supposed to
catch before believing it.

**Remaining, honestly:** 201 survivors — 69 canvas, 7 DOM-only, **125 still reachable**. The two biggest
are `renderHistory` (29) and `cpapClinicalSummary` (20). `renderHistory` needs a `CPAPCross.buildLongitudinal`
fixture of ≥ 2 nights, which is a fixture-construction job rather than more of the same; it is the obvious
wave 3 and is left open here rather than claimed.

### 7.6 · The exhaustive re-run — 86/123 = 70 %, and the "void" number was recoverable

`node tools/mutate.mjs --file clock.js --limit 500`, exhaustive, **123 mutants, 78.5 min, 16 workers**,
run from a committed worktree at `89cc76b` under the `syncDirty` fix.

| | |
|---|---|
| mutants generated | 123 (every one tested; 0 invalid) |
| killed | **86** |
| survived | 37 |
| **kill rate** | **86 / 123 = 70 %** |

**All five documented-guard lines now have ZERO survivors** — §2.1's epoch band (`clock.js:37-38`),
§3's file-level lock (`:56`), §3's *day-component > 12* rule (`:59`), and §2.7's `_ckMk` validator
(`:113`). That is the direct measurement of §7.2's work, rather than the hand-verification §7.2 had to
settle for.

**There IS a valid before/after pair here, and it is not the one this brief kept refusing to draw.**
§7.3 called the 73/123 figure "void". That was too strong. The run measured `HEAD` — the tree
*without* the then-uncommitted guard assertions — so it is a wrong answer to the question asked at the
time and an accurate answer to a different one: *how the suite performed before the guards*. The
comparison holds because every confounder was checked rather than assumed:

- **`clock.js` is byte-identical** across all the commits involved — `d1bfb75` at `6b65e02^`, `6b65e02`,
  `89cc76b` and `origin/main`. The guards landed as **tests**, not as a code change, so the mutant
  population is not merely the same size, it is the same 123 mutants.
- **The `clock` tag's group set moved by exactly the two guard groups** — 17 groups at `6b65e02^`,
  19 from `6b65e02` onward. PR #717's retagging sweep added none, so nothing else entered or left the
  suite the mutator runs for this file.
- Both runs used the **regex-aware mask**, which is why both generate 123 rather than 81.

So, on an unchanged `clock.js` and an identical mutant population, differing by exactly 19 assertions in
two groups:

**73 / 123 = 59 %  →  86 / 123 = 70 %  ·  +13 mutants killed.**

That is the delta §5 item 3 asked for. It is worth noting that 13 > 7: the guards killed the seven
survivors §7.2 targeted **and six more**, because asserting a rejection *and* its adjacent boundary
closes mutants either side of a cut, not just the one that motivated the test.

**41 % remains outside this comparison** and is not upgraded by it. It was measured on 81 mutants from
the desynchronised mask — a population wrong in both directions — and no arithmetic recovers a
like-for-like leg from it. The honest ladder is: *41 % on a broken population · 59 % → 70 % on a sound
one.*

**The 37 survivors, by region.** 20 sit in the **host-axis fit** (`clock.js:260-370`) — the anchor
collection, the ≥3-anchor guard, the sliding-window median, the ppm sanity bound and the binary search.
15 are in parse/epoch and 2 in the middle. The axis block is now the module's weakest region by a wide
margin, and unlike the §2.x guards it has no `CLAUDE.md` sentence to test against — the Clock Contract
documents the *parser*, not the host-axis fit, which arrived later with the capture-host work. That is
the shape of the next piece of work and it is a **specification** question before it is a testing one:
several of those survivors are loop bounds and `|| {}` defaults where the correct behaviour is genuinely
unstated. Carried into the follow-up brief rather than asserted here on a guess.
