<!--
  JS-SEALED-ASSERTION-DEAD-END-2026-08-05-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-08-05 · **Created:** 2026-08-05

# Lexical name resolution is not analysis — why the JS "sealed assertion" hunter was abandoned

A negative result, recorded so it is not attempted a third time. The Python sibling
(`capture-host/blind_spots.py`, #965) works and is validated; the JS transfer does not, and the reason
is structural rather than a missing afternoon of polish.

## 1 · What was attempted, and why it looked good

`blind_spots.py` finds, by reading the tests, arguments a double accepts and throws away — 690 of them
in `capture-host/`, in 0.39 s, and a full-suite mutation confirmed the family is real (a swapped
`free_gb`/`free_pct` in a user-facing alert survived all 2851 tests). The obvious next move was to point
the same idea at the JS lane.

**Scoping first said no, and scoping was right.** The specific family barely exists in JS: **22**
stub/fake/spy mentions across **32,895** lines of `tests/dex-tests.js`, **zero** in the runner, because
groups drive REAL modules through `env` and committed fixtures rather than doubles. And the economic
argument was weaker too — JS mutation is already parallel, worktree-isolated and tag-scoped
(`tools/mutate.mjs --jobs`), against Python's 11-minute serial suite.

So the attempt was narrowed to a *different* family that this lane does have, with a precedent removed
from #945 this week: an assertion that **computes its own answer and never reaches the module**.
`tests/dex-tests.js:3020` already guards one instance by hand — *"the group below would vacuously
pass"* — which is the whole idea, unautomated.

## 2 · What was built, and what it reported

Lexical, on `tools/js-lex.mjs` (the one shared lexer — no AST, matching the repo's single-devDependency
posture). Rule: an assertion is SEALED when every identifier in its observed expression resolves to a
declaration the file can see and none reach `env`.

Successive false-positive classes were found and fixed, each by hand-reading the hits:

| fix | hits after |
|---|---:|
| first version | 132 |
| track **reassignment** (`var esc = null` … `esc = m.exports.escapeHTML`) | 96 |
| the **accumulator rule** (a flag set inside a loop over module output) | 72 |
| **in-place mutation** (`chipless++`, `bad.push(x)`, `seen[k] = v`) | 5 |
| **nested-bracket index-assign** + **out-parameters** (`diff(a, b, '', gd)`) | 0 |

Zero hits, with a self-test passing 6/6 and a reported reach of **4,901 assertions examined, 99 %
resolved to the module**. Read as a clean bill of health it was a good result.

## 3 · The known-answer control that killed it

It was not a clean bill. Planting a #945-shaped tautology into `dex-tests.js` — an array built in the
test, asserted on itself, never calling the module — **the tool did not flag it**, and counted it among
the 99 % "resolved to the module".

**Root cause: name resolution with no scope analysis.** The declaration map is file-wide, and in a
32,895-line file short names collide massively:

```
s   261 distinct assignments merged into ONE name
a   223
m   143
r   140
d    97          (2,950 distinct names total)
```

So nearly any expression using a short local "reaches `env`" through an unrelated declaration hundreds
of lines away. The 99 % figure measured collisions, not coverage — and every intermediate count in §2
is equally untrustworthy, in the opposite direction.

**This is §2.8 of `papers/dead-ends.html` in another domain:** a null from an uncalibrated search is not
evidence. The control cost one planted case and settled in seconds what five rounds of hand-tuning had
not.

## 4 · What a working version needs (measured, not guessed)

Building it produced the requirements list, which is the salvageable part. An AST with real **scope
resolution**, plus handling for every class §2 hit by hand:

* **control dependence** — `var ok = true; xs.forEach(v => { if (…) ok = false; }); T.ok(…, ok)` observes
  the module through the loop, not through a value
* **in-place mutation** — `push`/`++`/index-assign, including nested brackets
* **out-parameters** — `diff(exp, fix, '', out)`, which is how BOTH golden-equivalence gates are written
* **source-scan gates** — assertions over module TEXT rather than behaviour; legitimate, must not flag
* **anti-vacuity guards** — `T.ok('a substantial number of cards were parsed', cards >= 300)` is good
  practice and must never be reported

That is a parser devDependency and roughly half a day, against a lane that already has a mutation
harness and its own charter (`audits/TEST-AUDIT-PROMPT.md`).

## 5 · Disposition

**Do not rebuild this lexically.** If it is ever wanted, start from an AST with scope resolution and
begin with the planted-tautology control, not with the report. The tool was deleted rather than shipped
at 0 hits: in this repo a zero that means "could not resolve" reads as "clean", which is the failure
class the whole effort was meant to expose.

**What survived the attempt** — found by hand while validating hits, and worth more than the tool:
`tests/dex-tests.js:14548` asserted `1.5 - CLEAN_HI > 0.4`, arithmetic over two constants declared in
the test. Its own comment said *"if someone widens the threshold toward 1.0, this reds"*; it could not,
because `verityFailureClass`'s threshold was never read. Widening the module to `>= 1.1` left it green.
It now PROBES `cls()` for the module's own boundary — fixed in the same changeset, negative-controlled
three ways (widen to 1.1 → reds; widen to 1.4 → reds; narrow to 1.6 → stays green).

## 6 · Done when

* This brief exists and `papers/dead-ends.html` §2.9 records the wall. — **done**
* The margin guard reads the module's threshold rather than restating it. — **done**
* No lexical sealed-assertion tool is committed. — **done** (deleted before commit; never entered a PR)
