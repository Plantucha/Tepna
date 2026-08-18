<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [PulseDex]
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---
12 assertions pinning `parseRRInput`'s physiological window and its four distinct refusal reasons —
killed from the fleet crawl's survivor set.

The window is `v >= 250 && v <= 3000` ms (240–15 bpm), and the four refusals are separate messages a
user reads to know *why* a file yielded nothing: no numeric intervals, all values outside the window,
too few usable intervals, or a delimiter/header problem.

**One planted mutation survived the first draft of this group, and the reason is worth recording.**
Flipping `tsValid`'s `&&` to `||` changed nothing I had asserted: `t0Ms` and `offsetMin` are `null`
either way. Diffing *every* returned field showed the only difference was `tsMs` — `null` in the real
code, `[]` under the mutant. So the group now asserts that too:

    T.eq('…and no timestamp series at all — null, not an empty array', ok.tsMs, null);

An empty array and `null` are not the same answer: `[]` says "timestamps, and there are none",
`null` says "no timestamp series". Re-planting after the addition gives 3 failed assertions.
