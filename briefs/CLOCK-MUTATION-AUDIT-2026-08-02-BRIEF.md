<!--
  CLOCK-MUTATION-AUDIT-2026-08-02-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** IN-PROGRESS — 2026-08-02 (**§5 items 1 and 2 EXECUTED — see §7.** The mask is regex-aware and the three documented guards are gated, each mutant verified killed. §5.3's re-run is running; §5.4 and §5.5 remain, and §5.5 is being audited next per the owner's call.) · **Created:** 2026-08-02 · **Follows:** `TOOL-INVOCABILITY-SWEEP-2026-08-02-BRIEF.md` §6 · **Tool:** `tools/mutate.mjs`

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

- [ ] `codeMask()` handles regex literals, or detects desync and refuses; verified on `clock.js`.
- [ ] §2.7 component-range, §3 DMY boundary and §2.1 epoch-band mutants are killed by new assertions,
      each verified by re-applying the exact mutant.
- [ ] `clock.js` re-run exhaustively; the before/after rate recorded in this brief.
- [ ] The two zero-kill modules diagnosed (no test, or mis-tagged test).
- [ ] A note here on whether the 40 untagged files are untested or merely unselectable.


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
