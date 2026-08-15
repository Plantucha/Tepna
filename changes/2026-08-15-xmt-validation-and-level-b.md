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
