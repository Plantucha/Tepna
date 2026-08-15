---
bump: minor
type: added
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---

Validates Tepna's existing extreme mutation testing against the published methodology, and adds the
statement level the literature identifies as its limitation.

**LEVEL A WAS NOT REBUILT.** `tools/extreme-mutate.mjs` already implements method-level XMT, and the
audit found it MORE faithful than expected: Descartes' full operator set, `MethodClassification`'s
"pseudo-tested iff EVERY applicable mutant survives / partially-tested when mixed", coverage as a
PRECONDITION (Betka & Wagner: "would not notice it, **despite having coverage**"), and ported
stop-matchers. Two self-corrections in its history both moved TOWARD the literature — the coverage leg
cut a claimed 48.6 % pseudo-tested rate on hrvdex to an honest 5.4 %.

**`audits/EXTREME-MUTATION-VALIDATION.md`** records the requirement→implementation mapping with
evidence per row, and states plainly what could NOT be read: Betka & Wagner (abstract only) and Maton
et al. (403/timeout). **No claim of reproducing either paper is made.** PseudoSweep's source WAS read
directly, which is where the statement-eligibility enum and the instrument-don't-delete strategy come
from.

**Phase 1 — controlled fixtures.** `xmt-fixture.js` + an observer group: a tested function (killed), a
pseudo-tested one (survived), a SIDE-EFFECT-tested one (killed — proving the tool does not confuse
"return value unused" with "untested"), and a non-applicable accessor (excluded). Plus determinism,
byte-identical restoration, and three fail-closed refusals that all fired during the audit.

🔴 **A REAL BLIND SPOT, found only because a fixture had a known answer.** The first Fixture B was the
canonical `function calculateSomething() { return 42; }` — and the tool EXCLUDED it under Descartes'
`constant` stop-matcher rather than reporting it. Faithful to Descartes, and also a limitation:
**a genuinely unobserved function is unreportable if its body happens to be a single literal.** The
tool's own 30 selftests all pass and could never surface this — every one exercises a pure function,
none runs the pipeline.

**Phase 2 — and the most important number here.** `clock.js`: 13/13 functions tested, zero
pseudo-tested. `ecgdex-dsp.js`: **72 functions, ZERO pseudo-tested — and the fleet's WORST operator
kill rate, 33.8 %, with 1188 surviving mutants.** Level A alone would declare that file healthy. It is
not. That is the layered hierarchy demonstrated on real code rather than asserted: a function can be
entirely undeletable and still be full of unchecked detail.

**LEVEL B — `tools/stmt-delete.mjs`, statement deletion (SDL).** Maton, Kapfhammer & McMinn (ICSME
2024) measured **48 % of pseudo-tested statements outside pseudo-tested methods**, which is why method
level cannot be a complete assessment. Reported SEPARATELY from Level A by design: a file with 0
pseudo-tested functions and N pseudo-tested statements is the expected shape, not a contradiction.

Three deliberate departures from PseudoSweep, each recorded as a difference rather than glossed:

- **No AST.** One dependency in this repo; adding a parser is an architectural change. Uses
  `stripNonCode`, the shared lexer that blanks strings/comments/regex IN PLACE so offsets survive,
  plus depth tracking — the same mechanism `functionBodies` uses, so both levels agree on what a
  construct is. Not regex deletion: nothing matches raw source.
- **Declarations delete the INITIALISER, not the statement.** `var x = compute();` → `var x;`.
  Removing the binding makes every later `x` a ReferenceError, so the mutant dies on a CRASH and
  proves nothing about any assertion. This is the analogue of PseudoSweep's `DeclarationInstrumenter`.
- **Two of its mechanisms do not port** — `FinalModifierRemover`/`TempFinalInsertion` and
  `addDefaultReturn` are Java type-system artefacts. In JS a deleted `return` yields `undefined`,
  a genuine behavioural change. JS SDL is SIMPLER than the paper's.

Eligibility FAILS CLOSED — control-flow headers, nested functions and initialiser-less declarations
decline. `INCONCLUSIVE` is a verdict, never a kill: a mutant that never ran is not evidence.

⚠️ **`mutate.mjs:181` records a prior decision AGAINST statement deletion** ("mostly-invalid mutants
… drown the signal"). That judgement is about mixing SDL into an OPERATOR SWEEP; this is a separate,
separately-reported analysis over an explicit 4-file allowlist. The note is answered by MEASUREMENT —
`--json` reports `invalidRate`, and if it is high here too, the note stands.

**TCE INVESTIGATED AND DECLINED, WITH EVIDENCE** (§3c). Trivial Compiler Equivalence (Papadakis et al.
2015) was the strongest candidate for cutting the ~4700-survivor classification cost. It does not port
to JS via V8 bytecode: Ignition is a near-direct AST translation and the canonicalisation TCE depends
on happens later in TurboFan, which exposes no stable artefact. Measured — `i = i+1` vs `i += 1`
differ; so do `a+1` and `/*c*/ (a)+1`. **Three earlier probe iterations produced FALSE equivalence
results**, which is the transferable finding: a TCE implementation is unusually prone to claiming
equivalences it never established, and a false equivalence removes a mutant from the denominator
permanently.

CI: **advisory only.** Level B is experimental, costs one suite run per statement, and is not wired
into any gate. Baseline and ratchet come after the results are stable and manually reviewed.

**LEVEL B IS VALIDATED AGAINST PLANTED ANSWERS, AND THAT IS WHAT FOUND ITS BUGS.** Three statements
with known verdicts were planted inside a function Level A calls TESTED — observed (must die),
unobserved (must survive), and TRULY EQUIVALENT (survives, and the tool is *wrong* to report it, which
makes the equivalent-mutant limitation a tested property instead of a caveat). 3 of 3 now match.

🔴 **Getting there exposed that Level B had been blind to roughly HALF of every file it ran on.**
`splitStatements` emitted only a function body's top level, so a loop or branch body appeared in **no
subject list at all** — not ineligible, invisible. Eligible subjects on `clock.js` go 67 → 132 (+97 %);
`ecgdex-dsp.js` 555 → 1143 (+106 %). The earlier "85 eligible" figure was that undercount, and the run
read as complete. **None of the 26 selftests could have caught it** — every one exercised a flat
function body, so all 26 agreed with the bug.

The first fix silently did nothing: its guard matched RAW text, and the planted comment contains the
word "function", so the loop was skipped as though it declared one. `classifyStatement` had the same
flaw — a comment saying "function" or "if" declined a real subject. Both now match the `stripNonCode`
view; 10 selftests pin the recursion and the masked-eligibility rules.

⚠️ **§3d records a retraction.** Level B's first live finding — `clock.js`'s `se = se || 0` — was
reported here as a pseudo-tested statement and is **an EQUIVALENT MUTANT**: every call site guarantees
a number. Survival is not pseudo-testedness, SDL cannot separate the two, and TCE (the standard remedy)
does not port to JS — so every survivor needs manual triage. The test written for it is kept for an
independent reason: Clock §2 case 3's optional seconds had **zero** fixtures.

**A STATIC PRE-FLIGHT BEFORE THE FIRST REAL RUN FOUND FOUR MORE DEFECTS, NONE NEEDING A MUTANT.**
An object literal's `}` ended statements, splitting `return c ? { d: a } : null;` into two fragments
— **pre-existing**, and its mutants do not parse, so the suite fails to LOAD and the mutant is
recorded as **KILLED**: syntax errors inflating the kill count, a false green rather than noise.
Destructuring patterns did the same. Both are now fixed at the brace, plus a backstop that declines
any subject that does not parse (0 fragments fleet-wide) — because two unrelated constructs caused
this silently and a third would too. That backstop's first version parsed the MASKED text and
declined 30 % of valid subjects (308 on oxydex-dsp.js). And coverage is now a statement-level
precondition: §3e's recursion made branch-nested statements subjects, and an unexecuted statement
deleted passes the suite BECAUSE IT NEVER RAN — 3–7 % per file would have read as pseudo-tested.
It fails open toward testing. Its `covPath` was also wired to a call site that never received it.

**AND A LOAD FAILURE WAS BEING READ AS A KILL.** The verdict rule treated any non-zero exit as a
verdict, but a module that fails to PARSE exits non-zero with empty stdout exactly like a failing
suite. `ran` now requires the runner's TAP plan line, which it prints only on completion — proven on
a real tree (unparseable `clock.js`: exit 2, no plan, old rule KILLED, new rule INCONCLUSIVE).
Runtime throws stay real kills, deliberately: the suite still completes, so the test DID detect the
change. This mattered because of `const`: a declaration is mutated by dropping its initialiser, which
is a SyntaxError for `const x;` — **482 of 691 declarations on ecgdex-dsp.js and 423 of 568 on
ppgdex-dsp.js**, all 905 of which would have been banked as KILLED. They are now declined as
unmeasurable (one parse, not a suite run: 1037 runs saved fleet-wide). That blind spot is the
quantified cost of Level B's documented choice to DELETE rather than instrument — PseudoSweep
instruments, so `const` is measurable there and is not here.

✅ **LEVEL B'S FIRST REAL FINDING, AND IT IS THE PAPER'S CLAIM.** `clock.js` scores 13/13 functions
tested and ZERO pseudo-tested at Level A. At statement level, `resolveDMY`'s quote/whitespace strip
is pseudo-tested: every existing assertion feeds it a BARE stamp, so the strip ran on all of them and
was observed by none. Deleting it makes a quoted stamp match neither vendor regex, so the day>12
evidence is never seen and `locked` goes true → false — and `locked` means THE ORDER WAS PROVEN FOR
THIS FILE, so a quoted CSV silently falls back to the default order and every date in it is misparsed
with no error reported. Triaged as NOT equivalent (measured both ways), killed by 4 assertions, and
the kill VERIFIED by re-applying the mutant.

⚠️ That verification was a FALSE PASS on the first attempt: `--group=clock-contract` did not select
the group holding the new assertions, so the suite reported 42 green with the mutant applied. A
filter that misses the group is indistinguishable from a passing test.

