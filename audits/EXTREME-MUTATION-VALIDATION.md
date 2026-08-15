<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** REFERENCE (living — last-verified 2026-08-15)

# EXTREME MUTATION — VALIDATING LEVEL A AGAINST THE LITERATURE

**Verdict: Level A is VALIDATED, with one documented blind spot.**

`tools/extreme-mutate.mjs` implements method-level extreme mutation testing (XMT). This audit asks a
narrower question than "does it run": **does the algorithm correspond to the published methodology,
and does it produce the right answer on inputs whose answer is known independently?**

A citation in a source file is not evidence that the implementation matches the paper. This document
is the evidence.

---

## 0 · Literature basis, and what could NOT be read

| work | used for | access |
|---|---|---|
| Betka & Wagner, *Extreme Mutation Testing in Practice: An Industrial Case Study*, arXiv:2103.08480 | definition of a pseudo-tested method; coverage as precondition | **abstract only** |
| Maton, Kapfhammer & McMinn, *Exploring pseudo-testedness: empirically evaluating extreme mutation testing at the statement level*, ICSME 2024 | the Level-A limitation; SDL | **not readable** (403 / timeout) |
| PseudoSweep (`github.com/PseudoTested/PseudoSweep`) | statement eligibility; instrumentation strategy | **source read directly** |
| Descartes / Niedermayr — operator set, `MethodClassification` | Level-A operators and classification | via the implementation's own citations + PseudoSweep |

⚠️ **NO CLAIM OF REPRODUCTION IS MADE FOR EITHER PAPER.** The full texts of Betka & Wagner and Maton
et al. were not readable from this environment. Where this document states a correspondence, the
evidence is named. Where it does not, the correspondence is *unverified* and says so.

**Verified from Betka & Wagner's abstract:** a pseudo-tested method is one "where their functionality
can be entirely removed, and the test suite would not notice it, **despite having coverage**".
Coverage is therefore a *precondition*, not an incidental.

**Verified from PseudoSweep's source:** it *instruments* rather than deletes — separate `-sdl` and
`-xmt` passes, statements toggled at runtime. Eligible statements are an explicit 18-member enum:
`BREAK CONTINUE DO EXPRESSION FOR FOR_EACH IF INNER_CLASS INNER_CLASS_RETURN LAMBDA LAMBDA_RETURN
RETURN SWITCH SWITCH_ENTRY_ASSIGNMENT THROW TRY VARIABLE_DECLARATION WHILE`. It carries
`FinalModifierRemover`, `TempFinalInsertion` and `addDefaultReturn` — all Java type-system
accommodations.

**Verified from the paper's published summary:** **48 % of pseudo-tested statements exist outside
pseudo-tested methods.** That is the quantified case for Level B and the only figure from Maton et al.
used here.

---

## 1 · Literature requirement → Tepna implementation

| requirement | implementation | status | evidence |
|---|---|---|---|
| Descartes operator set (`void`/`null`/`empty`/`true`/`false`/`0`/`1`/`""` + typed variants) | `EXTREME_OPS` — 8 operators: empty, null, 0, 1, `''`, true, false, `[]` | **adaptation** | JS is untyped, so typed variants collapse into the untyped eight; recorded in the source |
| Pseudo-tested **iff every** applicable mutant survives; *partially-tested* when mixed | `classifyExtreme` / `classifyDescartes` | **exact** | selftests "covered + all survived is pseudo-tested", "covered + mixed is partially-tested" |
| Coverage is a **precondition** | `classifyDescartes` returns `not-covered` when `executions === 0` | **exact** | Betka & Wagner abstract; selftest "coverage is checked FIRST" |
| Trivial-method stop-matchers | `trivialMatcher`, conservative-by-construction | **adaptation** (subset of Descartes' 16) | selftest "a getter is excluded" |
| An empty outcome set is not a verdict | `not-applicable` excluded from the three verdicts | **exact** | selftest "cannot be filed as tested" |
| Statement-level (SDL) | — | **absent** | Level B, below |

**Two self-corrections in the implementation's history both moved toward the literature**, which is
itself evidence the correspondence is deliberate rather than incidental:

1. **The coverage leg was added after the fact.** Of 18 functions the tool once called pseudo-tested
   in `hrvdex-dsp.js`, **16 were never executed at all**; the honest rate was 2/37 = 5.4 %, not
   48.6 %. It also dissolved an apparent corroboration — c8 reporting hrvdex as least-executed was
   *the same fact read twice*, not independent support.
2. **The all-vs-mixed rule replaced "the empty body survived"**, which over-reported: a function whose
   body can be emptied unnoticed but whose `return 1` is caught does have some assertion behind it.

---

## 2 · Phase 1 — controlled fixtures

`xmt-fixture.js` (four functions) + the `xmt-fixture` group in `tests/dex-tests.js` (the observer).
The functions are deliberately trivial; **what decides each verdict is how the group watches them.**

| fixture | regime | expected | actual |
|---|---|---|---|
| A `add(a,b)` | return value asserted | tested | **tested** ✓ |
| B `calculateSomething(readings)` | called, result never observed | pseudo-tested | **pseudo-tested**, all 8 mutants survived ✓ |
| C `recordInto(sink,v)` | side effect asserted, return unused | tested | **tested** ✓ |
| D `getConstant()` | bare accessor | excluded | **excluded**, stop-matcher `constant` ✓ |

Fixture C is the one that matters for soundness: it proves the tool does **not** confuse *"return
value unused"* with *"untested"*.

### 2a · 🔴 A REAL BLIND SPOT, found only because the fixture had a known answer

The first Fixture B was the canonical textbook example:

```js
function calculateSomething() { return 42; }
```

**The tool EXCLUDED it** under Descartes' `constant` stop-matcher instead of reporting it. That is
faithful to Descartes — a constant-returning method is trivial by its rules — and it is also a real
limitation:

> **A genuinely unobserved function is unreportable by Level A if its body happens to be a single
> literal.**

The fixture was changed to carry a loop, a guard, an arithmetic operator and a threshold — all
unobserved — and the tool then reported it correctly. **The limitation is in the method, not the
implementation**, but it bounds what a green Level-A report means.

⚠️ The tool's own 30 selftests all pass and could never have surfaced this: every one exercises a
*pure function* of the tool, none runs the pipeline. This is the repo's recurring failure shape — a
check that ran and reported success about something it never examined — inside the tool built to
detect it.

### 2b · Other acceptance criteria

| criterion | result |
|---|---|
| deterministic verdicts | identical across repeated runs (time fields excluded) |
| clean source restoration | byte-identical after four runs |
| no working-tree corruption | `git status` clean for the mutated file |
| refuses without coverage | `NO PER-FUNCTION COVERAGE — refusing to classify` |
| refuses on a red baseline | `BASELINE IS RED — every function would read as tested` |
| canary (positive control) | `canary PASSED — emptying recordInto is noticed` |

Both refusals are **fail-closed** and both fired during this audit — the coverage refusal when the
fixture lived outside c8's `include`, and the baseline refusal on a stale working tree. Neither
guessed.

---

## 3 · Phase 2 — real Tepna code

### 3a · `clock.js` (the shared spine) — 13 functions

```
PSEUDO-TESTED 0   partially 0   not-reached 0   excluded 0   tested 13
100% of the 13 CLASSIFIED function(s) have an assertion that depends on them
```

**No survivors, so no manual classification was required.** For a file inlined into every bundle and
governing the Clock Contract, that is the expected and desirable result.

**This makes `clock.js` the ideal Level-B subject.** Maton et al.'s finding is that 48 % of
pseudo-tested statements lie *outside* pseudo-tested methods. A file with **zero** pseudo-tested
functions is precisely where that claim is testable on Tepna's own code: any pseudo-tested statement
found here is, by construction, invisible to Level A.

### 3b · `ecgdex-dsp.js` — 72 functions, and the most important result in this audit

```
PSEUDO-TESTED 0   partially 1   not-reached 4   excluded 0   tested 67
99% of the 68 CLASSIFIED function(s) have an assertion that depends on them
```

**`ecgdex-dsp.js` has the fleet's WORST operator-mutation kill rate — 33.8 %, with 1188 surviving
mutants — and ZERO pseudo-tested functions.**

Level A alone would declare this file healthy. It is not. Two-thirds of its operator mutants survive.

That is the layered hierarchy demonstrated on real code rather than asserted:

| layer | question | verdict on ecgdex |
|---|---|---|
| coverage | is the line executed? | 90.6 % reachable |
| **Level A (XMT)** | can a whole function be deleted unnoticed? | **no — 0/68** |
| traditional mutation | would a wrong operator or boundary be noticed? | **often not — 33.8 %** |

**A function can be entirely undeletable and still be full of unchecked detail.** Every one of
ecgdex's 67 tested functions has at least one assertion that depends on it existing; that says
nothing about whether its comparisons, constants and boundaries are observed. This is precisely why
the implementation's own header records the published correlation with traditional scores as moderate
(Spearman ~0.6) and calls XMT a RANKING tool rather than a substitute.

**No manual survivor classification was required for either file** — there were no pseudo-tested
survivors to classify. The 4 `not-reached` functions (`_rollMedian`, `_alignDevSeconds`,
`validateHR`, +1) are a different and cheaper finding: they are not called by `--group=ecgdex-dsp` at
all, so their mutants survive trivially. That is the distinction the coverage leg exists to draw, and
it is drawing it.

---

## 3c · 🔴 TRIVIAL COMPILER EQUIVALENCE — INVESTIGATED AND DECLINED, WITH EVIDENCE

> Papadakis, Jia, Harman & Le Traon (2015). "Trivial Compiler Equivalence: A Large Scale Empirical
> Study of a Simple, Fast and Effective Equivalent Mutant Detection Technique." ICSE 2015, 936–946.
> doi:10.1109/ICSE.2015.103

TCE was the strongest candidate for cutting this programme's largest cost: ~314 hand-classified
equivalents against ~4700 unresolved survivors, each currently needing a human probe. Equivalence is
undecidable in general (Budd & Angluin 1982, doi:10.1007/BF00625279), so a sound PARTIAL detector is
the only thing available, and TCE has the best empirical record.

**It does not port to JS via V8 bytecode, and the reason is a property of V8 rather than of the
paper.** TCE works because Java/C compilers CANONICALISE equivalent forms during optimisation. V8's
Ignition bytecode is a near-direct AST translation; the optimisation that would canonicalise happens
later in TurboFan, which exposes no comparable stable artefact. Measured:

| pair | should be | actual |
|---|---|---|
| `a+1` vs `/*c*/ (a)+1` | identical | **differs** |
| `i = i+1` vs `i += 1` | equivalent | **differs** |
| `var x=a; return x` vs `return a` | equivalent | **differs** |

⚠️ **THE WAY THIS INVESTIGATION FAILED IS THE MORE TRANSFERABLE RESULT.** Three earlier probe
iterations produced FALSE results before the one above:

1. An extraction matching **zero** opcodes — every comparison diffed empty files and reported
   `IDENTICAL`, including a false `EQUIVALENT-detected`.
2. Mnemonic-only comparison — reported `a+1` ≡ `a+0` identical, because the constant lives in the
   operand, not the mnemonic.
3. Weak address-stripping — dominated by source positions, so identical source was trivially
   identical and nothing else ever matched.

**A TCE implementation is unusually prone to claiming equivalences it never established, and a false
equivalence is the worst error available here**: it removes a mutant from the denominator
PERMANENTLY, and nothing re-checks it. If TCE is revisited, the bar is a fixture of known-equivalent
pairs the detector must FIND before it is allowed to mark anything — the same ground-truth discipline
that exposed Level A's constant-body blind spot in §2a.

---

## 4 · Status

**Level A — `tools/extreme-mutate.mjs` — VALIDATED.**

- Corresponds to the published method-level methodology on every point that could be checked.
- Produces correct verdicts on four controlled fixtures including the two that distinguish it from a
  naive implementation (side-effect-tested, and non-applicable).
- Deterministic, restores cleanly, and refuses rather than guessing in three separate degraded modes.
- **Documented limitation:** constant-bodied functions are excluded and therefore unreportable.

**Level B — statement-level pseudo-testedness — NOT IMPLEMENTED.** Design constraints are recorded in
§5.

⚠️ **Level A does not replace traditional mutation testing and this audit makes no such claim.** The
layers ask different questions, and the implementation's own header states the correlation with
traditional scores is moderate (Spearman ~0.6). It RANKS; it does not substitute for the sweep.

---

## 3d · 🔴 LEVEL B'S FIRST FINDING WAS AN EQUIVALENT MUTANT, AND ONLY MANUAL TRIAGE CAUGHT IT

Level B's first live result on `clock.js` was reported as:

```
● PSEUDO-TESTED STMT  _ckMk  L113  [EXPRESSION]  se = se || 0;
```

Deleting it leaves the suite green — verified by hand at 848, then 853 assertions. On its face that is
the paper's central claim reproduced: a pseudo-tested STATEMENT inside a function Level A calls
TESTED, in the Clock Contract's component builder.

**It is not. It is an EQUIVALENT MUTANT.** Every call site of `_ckMk` supplies `se` as a defined
number — six pass `m[6] ? +m[6] : 0`, and the two that pass `+m[6]` or `+m[3]` unconditionally belong
to regexes whose seconds group is MANDATORY (the 14-digit compact form, and 4a `HH:MM:SS DD/MM/YYYY`,
which returns null for `22:00 07/06/2026`). Measured both mutated and unmutated: identical behaviour
on every reachable input. **No input can reach the default.**

⚠️ **SURVIVAL IS NOT PSEUDO-TESTEDNESS.** A statement survives deletion either because nothing
observes it OR because nothing can distinguish it, and SDL cannot tell those apart. That is the
equivalent-mutant problem at statement level, and it is the direct reason the standard answer — TCE —
was investigated in §3c. TCE does not port to JS, so **Level B has no automated equivalence
detection at all** and every survivor needs the manual triage the task specifies.

**What actually caught it: writing the test and re-applying the mutant.** The test I wrote from
READING the code passed, and the mutant still survived — the repo's most-repeated lesson, earned
again: *a test written from reading the code passes while catching nothing.* Had I stopped at "test
written, suite green", a false finding would have been recorded as the headline result of this audit.

**The test was kept anyway, for an independent reason.** It covers §2 case 3's optional seconds
(`YYYY-MM-DD[ T]HH:MM[:SS]`), for which there were **zero** fixtures — measured, not guessed. It
closes a real grammar gap; it simply does not kill the mutant that led to it. Those are two different
claims and only one of them is about the mutant.

**Level B's status is therefore: WORKING, UNVALIDATED.** It correctly identified a surviving
statement. Whether it can find a genuinely pseudo-tested one on this fleet is still open, and the
`clock.js` run continues.

---

## 3e · 🔴 PLANTING KNOWN ANSWERS FOUND THREE DEFECTS — INCLUDING ONE THAT HID HALF THE SUBJECTS

§3d ended with Level B **working but unvalidated**: it had reported a survivor, and the survivor was
equivalent. The fix for "unvalidated" is the same one Level A got — plant statements whose answers are
known and check the tool against them, rather than reading its output and finding it plausible.

Three statements were planted inside `summarise` in `xmt-fixture.js`, a function asserted strongly
enough that Level A calls it TESTED — **which is the point**, since Maton et al.'s result is that
pseudo-tested statements hide inside methods that are not pseudo-tested:

| | statement | expected | why |
|---|---|---|---|
| **E** | `total += readings[i];` | **KILLED** | the return is asserted at two points |
| **F** | `stats.seen = stats.seen + 1;` | **PSEUDO-TESTED** | written every iteration, asserted nowhere |
| **G** | `n = n \|\| 0;` | **PSEUDO-TESTED**, *and wrong to be* | `readings.length` is always a number — no input distinguishes deleting it |

The spread is deliberate. A fixture where everything survives is passed by a tool that reports
everything; one where everything dies is passed by a tool that reports nothing. **G is the negative
control the equivalent-mutant limitation needs**: it mirrors `clock.js`'s `se = se || 0` exactly, so
the limitation is now a TESTED PROPERTY rather than a caveat in prose. An earlier draft used
`total = total || 0`, which `summarise(['x'])` separates (`NaN` vs `0`) — unobserved like F, not
equivalent. Mislabelling it would have repeated §3d's error inside the fixture built to prevent it.

**Final verdict: 3 of 3 known answers matched.** But only after three defects, and none of them were
visible in the tool's output:

- 🔴 **NESTED STATEMENTS WERE INVISIBLE — not ineligible, INVISIBLE.** `splitStatements` emitted only
  a function body's TOP level. `if (c) { … }` came out as one statement and declined as control-flow,
  correctly; its body then appeared in **no subject list at all**. F sits one brace deep and was
  neither killed nor reported. Measured across the allowlist:

  | file | eligible now | top-level only | hidden |
  |---|---|---|---|
  | `clock.js` | 132 | 67 | **+97 %** |
  | `ecgdex-dsp.js` | 1143 | 555 | **+106 %** |
  | `ppgdex-dsp.js` | 964 | 503 | **+92 %** |
  | `oxydex-dsp.js` | 1221 | 851 | **+43 %** |

  **Level B was blind to roughly half of every file it ran on**, and §3d's "85 eligible on clock.js"
  was that undercount. The run reported a smaller denominator and read as complete — this repo's
  most-repeated failure, a gate that ran and passed without examining the thing in question. **No
  selftest could have caught it**: all 26 exercised flat function bodies, so every one agreed with
  the bug.

- 🔴 **PROSE WAS LOAD-BEARING.** The first recursion fix did nothing, because its guard matched the
  RAW statement text — and F's comment contains the word *"function"*, so the loop was skipped as
  though it declared one. `classifyStatement` had the identical flaw: a comment saying "function" or
  "if" silently declined a real subject. Both now match the `stripNonCode` view, which also makes
  `no-content` exact (a comment-only fragment masks to whitespace). Six selftests pin it.

- **Subjects were reported at a preceding comment's line and kind.** `[EXPRESSION]` at G's comment for
  a subject that was a `RETURN` eleven lines lower — a human sent to the wrong line to judge the wrong
  construct. `emit` now advances to the first real character.

**What this says about the method, beyond the bugs.** Every one of these was found by a fixture with a
known answer and by nothing else — not by 26 passing selftests, not by a clean run over a real file,
not by reading the output. The tool's own numbers were internally consistent throughout. That is the
argument for keeping ground-truth fixtures beside any measurement tool this suite ships, and it is the
second time in this audit that a known answer overturned a plausible result (§2b's stop-matcher was the
first).

---

## 3f · 🔴 THE PRE-FLIGHT: FOUR MORE DEFECTS, FOUND WITHOUT RUNNING A SINGLE MUTANT

§3e's fixes made Level B correct on an 11-statement fixture. Before spending two hours on 130 real
subjects, the subject list itself was audited statically — every defect so far had been in subject
CONSTRUCTION, and that can be inspected without executing anything.

**1 · An object literal's `}` was ending statements.** The splitter emitted on any `}` returning to
depth 0. In `clock.js`:

```js
return lmo >= 1 && … ? { d: ld, mo: lmo } : null;
```

came back as **two** "statements" — `return … ? { d: ld, mo: lmo }` and `: null;` — both eligible,
neither a statement. **This predates the recursion work.** `braceKind` now decides at the `{`
whether it opens a block or a value, from what precedes it, and errs toward `block` (a lost subject
is visible; a split expression is not).

⚠️ **The consequence is a FALSE GREEN, not noise.** Deleting a fragment leaves source that does not
parse, so the suite fails to LOAD — and a load failure is indistinguishable from an assertion
failure. Every such mutant was recorded as **KILLED**. `mutate.mjs:181` predicted invalid mutants
would "drown the signal"; the real behaviour was worse, because they inflated the kill count instead.

**2 · Destructuring patterns, the same class from a different construct.** `const { a, b } = f();`
split into `const { a, b }` and `= f();`. Six fleet-wide after fix 1.

**3 · So the fix is a BACKSTOP, not a construct list.** A subject whose text does not parse is now
declined outright (`not-eligible:unparseable`). Two unrelated constructs produced this bug silently;
a third would too. Fragments after both fixes: **0 on every file.**

**4 · The backstop's first version declined 30 % of all subjects.** It parsed the *masked* text —
where strings and regexes are blanked — so `z.replace(':', '')` became `z.replace(   ,   )` and
`return x ? 'high' : 'low';` lost both arms. Valid statements, declined: 308 on `oxydex-dsp.js`, 23
on `clock.js`. Every other rule here matches masked code, which is precisely why this one looked
right. Parsing needs the real characters back.

**5 · Coverage is a precondition at statement level too — and was not.** The tool argued a statement
has no coverage precondition of its own, the enclosing function's being Level A's concern. That was
true while every subject sat at a covered function's top level, and **§3e's recursion ended it**:
statements inside `if` and loop bodies are exactly the ones a test skips while still covering the
function. Delete one, the suite passes BECAUSE IT NEVER RAN, and it reports as pseudo-tested — Betka
& Wagner's precondition violated one level down, the same error whose Level-A fix cut a claimed
48.6 % to 5.4 %. Measured: 3–7 % of subjects sit on never-executed lines (4 on `clock.js`, 69 on
`ppgdex-dsp.js`). It fails OPEN toward testing — absent coverage we cannot prove non-execution, and
an invisible hole in the denominator is worse than a wasted run.

**6 · And the precondition was wired to a call site that never received it.** `runLevelB` gained a
`covPath` parameter; the one call passed three arguments. `covPath` would have been `undefined`,
`covered` would have stayed `null`, and the whole thing would have done nothing — while the code
read as correct. Caught by grepping the call site rather than the definition.

**None of this required running a mutant.** Fragmentation is a property of the subject list; coverage
is a property of a committed artefact. The two hours were the reason to look, not the way to find out.
The 51 selftests were green before and after every one of these defects.

---

## 3g · 🔴 A LOAD FAILURE IS NOT A KILL — AND 905 MUTANTS COULD NOT PARSE

§3f fixed the splitter so no subject is a fragment. It did not fix how a RESULT IS READ, and those
are independent: the verdict rule was

```js
return { ran: e.status !== undefined, passed: false };   // "a non-zero exit is a VERDICT"
```

A module that fails to PARSE exits non-zero with empty stdout, exactly like a suite whose assertions
failed. **Every unparseable mutant was therefore banked as KILLED** — a check reporting success about
something it never examined, in the direction that inflates test strength.

`ran` now requires POSITIVE EVIDENCE: `tests/run-tests.mjs` prints its TAP plan `1..N` once it
completes, whatever the verdict, and prints nothing if it dies at load. No plan ⇒ INCONCLUSIVE.
Demonstrated end-to-end on a real tree, not asserted:

| tree | exit | plan line | old rule | new rule |
|---|---|---|---|---|
| clean | 0 | ✓ | — | — |
| `clock.js` made unparseable | 2 (`SETUP ERROR: Unexpected token ')'`) | ✗ | **KILLED** | **INCONCLUSIVE** |

⚠️ **Runtime throws remain real kills, deliberately.** A deletion that makes the code throw *inside a
test* still lets the suite finish and print its plan — the test DID detect the change. Only a failure
to run at all is inconclusive.

**And then the reason it mattered: `const`.** A declaration is mutated by dropping its initialiser and
keeping the binding — sound for `var x;` and `let x;`, a **SyntaxError for `const x;`**, which requires
one. Measured: **482 of 691 declarations on `ecgdex-dsp.js`, 423 of 568 on `ppgdex-dsp.js`.** Under the
old rule all **905** would have been recorded as killed. `clock.js` uses `var` throughout and has zero,
which is the only reason the first real run was not poisoned.

Deleting the whole statement is not the alternative — that removes the binding and every later
reference becomes a `ReferenceError`, the unsound shape the initialiser trick exists to avoid. So the
subject is **DECLINED**: unmeasurable, and saying so costs one parse instead of a full suite run.

**This is a real limitation, and it is the price of a documented departure.** §Level B chose to DELETE
rather than instrument, because instrumenting needs an AST. PseudoSweep instruments, so a `const`
initialiser is measurable there and is not here. **905 statements — the largest single blind spot in
Level B — trace directly to that choice.** The departure was recorded as a difference; this is its
cost, quantified.

**Final measurable subject counts:**

| file | measurable | −`const` | −uncovered | suite runs saved |
|---|---|---|---|---|
| `clock.js` | 126 | 0 | 4 | 4 |
| `ecgdex-dsp.js` | 631 | 482 | 20 | 502 |
| `ppgdex-dsp.js` | 492 | 423 | 46 | 469 |
| `oxydex-dsp.js` | 1159 | 0 | 62 | 62 |

---

## 4a · ⏱️ LEVEL B'S COST, MEASURED — one suite run per statement is the whole story

`clock.js` has **85 eligible statements** across 13 functions (133 total; 43 declined as control-flow,
4 as containing a function, 1 as a declaration without an initialiser). At 10 parallel workers against
`--group=clock` — 58 groups, ~848 assertions — the run took **~2 hours**.

That is the number that decides whether Level B can be routine, and it says: **not as a sweep.** Level
A costs ~1 mutant per function (13 for this file); Level B costs ~1 suite run per statement (85). The
allowlist is therefore not timidity, it is the operating envelope.

Two consequences for CI, both already reflected in the design:

- Level B is **advisory and pointed**, never swept. `LEVEL_B_ALLOWLIST` is four files.
- Coverage-directed selection (#1246) is the obvious lever — a deleted statement can only be noticed
  by a group that EXECUTES it, and `.mutation-sweeps/per-group.json` already holds that map. Level B
  does not yet use it. Doing so is the difference between ~2 h and minutes, and it is the single
  highest-value follow-up here.

---

## 5 · Level B — design constraints (Phase 4 input)

**No AST parser is available.** The repository has exactly one dependency (`@biomejs/biome`) and is
deliberately dependency-minimal — 100 % local, no CDNs, no network in any bundle. PseudoSweep's
approach (JavaParser + instrumentation) has no equivalent here without an architectural change.

The defensible adaptation is `tools/js-lex.mjs`, the repo's shared regex-aware lexer that masks
strings, comments and regex literals before any structural work. This is **not** regular-expression
deletion: it is lexer-driven depth tracking, the same technique `functionBodies` uses and which all
four mutation tools already share, so they cannot disagree about what a construct is.

**Consequences to carry into the design:**

- Two of PseudoSweep's mechanisms do not port. `FinalModifierRemover`/`TempFinalInsertion` handle
  Java's `final`; `addDefaultReturn` handles a method falling off the end after a `return` is
  deleted. **JS has neither problem** — a deleted `return` yields `undefined`, which is a genuine
  behavioural change rather than a compile error. JS SDL is *simpler* than the paper's.
- Eligibility must **fail closed**: a construct the lexer cannot confidently recognise is NOT
  eligible for deletion. Over-restricting loses findings; under-restricting produces invalid mutants
  that score as killed and manufacture a false sense of strength.
- `tools/mutate.mjs:181` records a prior decision *against* statement deletion — "exotic operators
  (statement deletion, method swaps) produce mostly-invalid mutants and drown the signal". That
  judgement is about statement deletion **mixed into an operator sweep**; Level B is a targeted,
  separately-reported analysis. **The design must answer that note with measurement, not step around
  it.**
- Level A and Level B results must be reported **separately**. A file with 0 pseudo-tested functions
  and 12 pseudo-tested statements is a meaningful and expected outcome — it is the reason Level B
  exists.
