---
bump: minor
type: added
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---

Two tools for the expensive half of survivor triage, plus the classical baseline that says how much
either is worth.

**The bottleneck is proposing, not checking.** ~4700 operator mutants survive the JS sweeps
unresolved. Each needs a killing test or a written equivalence proof, and the costly step is the
first: finding an input that separates mutant from original. Checking a proposal is two expression
evaluations.

**`tools/survivor-witness.mjs`** lifts a survivor's condition, asks the local model for a VALUE that
separates the two expressions, and evaluates both to confirm or discard it. The model is never
trusted — every proposal is falsified or kept by execution.

**Why a local model is allowed here, having failed twice on this box.** Ranking assertion strength
produced 0 useful flags of 3 and missed a planted control; auditing code against the deep-audit
charter produced 0 confirmed findings across 7 prompt variants, including one claim three variants
agreed on. Both asked the model to JUDGE CORRECTNESS, where a wrong answer is confident, specific,
and costs a verification run to disprove. This asks for a VALUE, and the falsifier is free. That is
the distinction that makes the difference, not a better prompt.

**`tools/witness-baseline.mjs` exists to try to make the first tool worthless.** A peer's framing:
the model is a heuristic proposer working because searching is expensive and checking is free — the
same bargain a quantum annealer makes. D-Wave's speedup claims did not collapse because the hardware
failed; they collapsed when Rønnow, Troyer et al. (Science, 2014) compared against WELL-TUNED
classical solvers and the advantage evaporated. So the baseline tries a fixed ladder of values
against every variable in the condition, with no model at all.

⚠️ **It runs on the SAME probe set, not a fresh sample** — the probe set was selected BY the
technique (survivors that sit in an `if`, lift by a balanced-paren scan, evaluate standalone), and
that selection runs toward simple self-contained booleans, which is exactly where an enumerator is
strongest. Sampling separately would flatter the model.

**Measured, after tuning the baseline — which moved it 354 → 221 → 215 misses.** An untuned baseline
measures the ladder, not the model, so the first number was not reportable. Tuned classical:
**1266/1847**. Model on the 581 it missed: **417 (71.8 %)**, every one independently re-verified,
92 % structured values. Union **1683/1847 (91.1 %)** — which is **30.8 %** of the 5471 survivors, not
of the total mutant population.

**A witness is not a test.** Under RIPR (Reachability → Infection → Propagation → Revealability) a
condition-level witness establishes INFECTION only. Converting five witnesses to tests killed
**zero** — `!isFinite(d_plaw)` was satisfied by original and mutants alike, so the infected state
never propagated to an observable. Recorded because it is the honest ceiling on what these tools
deliver: they cut the proposing cost, and they do not produce kills on their own.

Advisory tools. Not wired into any gate.
