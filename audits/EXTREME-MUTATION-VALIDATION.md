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
