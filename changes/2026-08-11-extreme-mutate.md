<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---
Add tools/extreme-mutate.mjs — find PSEUDO-TESTED functions by deleting their bodies.

Extreme mutation (Descartes / Niedermayr et al., arXiv:2103.08480): one mutant per function — empty
the body — instead of ~12 operator mutants. A function that survives is pseudo-tested: the suite runs
it and asserts nothing about what it does.

It fits this fleet exactly. The JS suite has 77.3% branch coverage and kills 38.5% of mutants, and
that gap IS pseudo-testing: code executed, results unchecked.

MEASURED, fleet-wide, in about five minutes of machine time against ~24 h for an operator sweep:

  glucodex   8/61    cpapdex   6/51    motiondex  4/43
  hrvdex    18/37    pulsedex 21/50    oxydex    19/143   (240 s vs an 88 min operator sweep)

hrvdex and pulsedex are the worst, and they are exactly the two files c8 independently flagged as
under-executed (40.0% and 59.7% function coverage). Two instruments agreeing.

THE RANKING IT CHANGES. Six of glucodex's eight pseudo-tested functions rank 18th-40th by survivor
count — correlateNutrition is rank 34 with 3 survivors, tzOffset rank 40 with 1 — yet their entire
bodies can be deleted with the suite green. Survivor count measures how much operator-level signal a
function emits; it cannot see that nothing asserts on the function at all.

IT IS NOT A SHORTCUT TO 99%, and the measurement says so plainly: pseudo-tested functions hold only
163 of 2227 survivors (7.3%) across glucodex and oxydex. It ranks by SEVERITY, not by volume. The
99% operator programme is unchanged.

THE SAFETY FINDING: fmtClock, fmtDate and fmtDateTime are pseudo-tested in glucodex, cpapdex,
motiondex, hrvdex AND pulsedex. Those are the Clock Contract §5 display functions — the ones that must
read getUTC* so output is viewer-timezone-independent. A non-negotiable invariant currently protected
by no assertion in most of the fleet.

11 known-answer selftests. Two caught while writing them: an already-empty body returns null rather
than a free false positive on every stub, and the selftest helper was overloaded such that
ok(name, actual, expected) passed for any non-empty string — three vacuous passes from one helper,
now split into ok() and eq().
