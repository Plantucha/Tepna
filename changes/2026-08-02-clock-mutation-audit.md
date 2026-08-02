<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: []
brief: CLOCK-MUTATION-AUDIT-2026-08-02-BRIEF.md
---
The Clock Contract is the least-tested module in the suite: **41 % of mutations to `clock.js` go unnoticed**.

`CLAUDE.md` opens the Clock Contract with *"non-negotiable — every app + every future node must obey"*. Exhaustive mutation run — all 81 mutants, 40 min: **31 killed, 50 survived, 6 of those comment noise → 31/75 = 41 %**.

Against the 71-file roster sweep (12-mutant samples): `pulsedex-dsp`/`dex-ingest`/`hrvdex-dsp` 100 %, `oxydex-dsp` 91 %, `ppgdex-dsp` 83 %, `integrator-dsp` 58 %, `ecgdex-dsp` 50 %, **`clock.js` 41 %**.

**The mechanism is uncomfortable:** `clock.js` is also the most *expensive* module to test — one `--group=clock` run takes **191 s**, because clock is loaded by everything and its tag selects sixteen heavy groups. Expensive-to-test correlates with under-tested, which is backwards for a spine. No coverage report shows this: `clock.js` has near-total line coverage precisely because every test loads it.

**Two of the survivors are documented invariants:**

- **§2.7's component-range validation** — the guard that exists because *"`Date.UTC`'s silent roll is a fabricated instant"*. **Seven mutants of that one line survive**: every boundary on month and day, plus three `&&`→`||` rewrites. Nothing checks that month 13 or day 32 is refused.
- **§3's DMY/MDY rule** — *"any row with day-component > 12 ⇒ unambiguous"*. The `>`→`>=` mutant survives, so nothing distinguishes 12 from 13 at the exact boundary the rule is written around.
- Plus §2.1's numeric-epoch plausibility band, the §2.5 midnight-roll loop, and the axis binary search.

**None of this says `clock.js` is buggy.** Every survivor is a statement about the suite, not the code.

**And a defect in the tool, found by this run:** 6 survivors mutate a *comment*. `codeMask()` desynchronises at `clock.js:81` — `s.replace(/^["']|["']$/g, '')`, a **regex literal containing quote characters**. The scanner isn't regex-aware, enters string state there, and stays wrong for the rest of the file. Its own header warned that regex literals are "rare in these DSPs"; in a timestamp parser they are not. Both the raw 38 % and the adjusted 41 % are reported so the correction is visible rather than laundered.

Brief only — no shipped source, no `manifestHash` movement, no fixture re-recorded.
