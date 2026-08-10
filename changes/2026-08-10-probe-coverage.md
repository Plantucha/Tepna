<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [PpgDex]
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---
Add tools/probe-coverage.mjs, and rebuild the ppgdex battery against what it measures.

probe-equivalence scores each family against the mutants in its `fn`'s LINE RANGE. A survivor in a
function no family names is not "unclassified" — it is INVISIBLE: not counted, not reported, not
missed. The run ends "all controls separated" and reads as complete.

Measured across the fleet before this change:

  ppgdex-dsp.js     736 survivors   57 claimable   679 invisible (92 %)
  cpapdex-dsp.js    488            133            355           (73 %)
  motiondex-dsp.js  287             92            195           (68 %)
  hrvdex-dsp.js     298            217             81           (27 %)

About 1310 survivors fleet-wide that no battery could reach. ppgdex had three families for a
46-function module and had been reporting clean probe runs throughout.

probe-coverage.mjs reports a battery's REACH beside its verdicts, groups the invisible survivors by
enclosing function (each row is a family nobody wrote), exits non-zero when the majority is
invisible, and carries 15 known-answer selftests.

ppgdex rebuilt: 57 -> 438 claimable (7.7 % -> 59.5 %) via 32 pipeline families over analyze(). What
was missing was never access — analyze is exported — but a fixture that survives beat detection: the
existing generator emits a linear ramp, so every beat-dependent function returned empty. The new
pulsatile generator gives 59 beats at HR 60 and 130 at HR 72, and reaches cvhrFromNN (the brief's
"hard one", 57 survivors) with cvhrIndex 0 -> 84.1 -> 108.4 across flat / 40 s / 30 s HR cycles.

No ppgdex classifications are emitted: the available sweep predates #1129 and only 370 of its 736
survivors still sit on their recorded line. A fresh sweep is owed before recording verdicts.
