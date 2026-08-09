<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [PpgDex]
brief: PPGDEX-TESTABLE-SURFACE-2026-08-08-BRIEF.md
---
`parsePPG` is 348 lines with **38 surviving mutants**. Probing them — original and mutant in separate realms, 68-input battery — found 10 with a distinguishing input. Nine assertions aimed at the inputs the probe actually reported kill **5**.

They are boundaries a real file crosses, not synthetic ones:

- **a headerless 6-column file** must still parse, via per-row tail resolution — a real Polar Sensor Logger case, and the mutant turns the whole file into *"No PPG samples parsed"*;
- **the row-count floor from both sides** — exactly 10 parses, 9 is refused. Only a test at exactly 10 can tell `n < 10` from `n <= 10`;
- **a header-only file is refused, not fabricated.** The mutant returns a record with `n=0` and a *negative* duration — a shape no consumer checks for, which is precisely why it must not be produced;
- **`fs` is derived and positive, every `relSec` finite and strictly increasing**, and the spacing equals `1/fs`. One mutant zeroes the divisor and yields `fs=0` with every `relSec` null: a recording that exists but has no time.

**One probe result was discarded as an artefact.** `L439`'s mutant differed only by throwing `DexClock is not defined`, because the probe realm has no co-loaded clock while the suite does. That is my harness leaking into the classification, not a behaviour of the code, so it is not asserted. Recorded in the test because a probe realm is not the suite realm, and a difference *caused by the probe* is not evidence about the subject.

Running total for `ppgdex-dsp.js`: **395 → 406 killed** (6 from `lombScargle`, 5 here), 34.0 % → **34.9 %**, against a measured ceiling of ~52 %.

Tests only — no shipped source, no `manifestHash` movement, no fixture re-recorded.
