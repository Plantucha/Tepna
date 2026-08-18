<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [suite]
brief: MUTATION-SUITE-FOLLOWUPS-2026-08-17-BRIEF.md
---
Resolves §3's open contradiction by experiment, and the answer moves the whole coverage-selection
plan from "build it" to "blocked on a capture bug".

**The test:** mutate `hrvdex-dsp.js:853` and run **only** group 338. It fails (1 failing, 46 passing,
exit 1). A test cannot detect a change to a line it never executes — so the group executes line 853,
and the coverage map that attributes it **zero** lines is wrong. Corroborating: c8's report for that
group holds one `hrvdex-dsp.js` record with **384** executed lines, exactly the load-time baseline,
so it captured the module load and none of the group's own calls into it.

**The scale is the real finding.** 188 of 494 groups attribute zero lines to any DSP. The map cannot
tell *"touches no DSP"* from *"was not captured"*, and those need opposite treatment — so the only
safe reading selects all 188 on every mutant, against a tag filter that runs perhaps 40 for a node
file. **The safe map is slower than the filter it replaces.**

So `MUTATION-PROGRAM-FOLLOWUPS` §6's "one optimisation worth building before more tests" is blocked on
a coverage-capture bug rather than on effort: until a zero attribution provably means zero, selection
is either unsafe (measured: 6 lost kills on one file) or pointless. That prerequisite was never on
anyone's list because the map appeared to work.

The measured speedup, for the record, was **1.46×** (3 m 52 s → 2 m 39 s on hrvdex at `--jobs 6`), not
the projected 10–100×.

Docs only: the map remains quarantined and no tool behaviour changes.
