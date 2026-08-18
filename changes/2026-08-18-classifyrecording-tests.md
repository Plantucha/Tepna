<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [PulseDex]
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---
The first survivors killed from the fleet crawl — 14 assertions pinning `classifyRecording`'s five
branches, both confidence constants, the ms→bpm conversion, and the absent-clock case.

**Chosen against the crawl's own ranking, deliberately.** The top killable clusters are
`_synthEdfSet` (38), `genSynthetic` (12), `genSyntheticACC` (12) — **fixture generators**, which
`SUBPROCESS-SURFACE` already flagged ("49 of its 67 work items were not production code"). Testing
test scaffolding is not the point. `classifyRecording` is production and decides whether a recording
is exercise / overnight / morning / spot.

⚠️ **The probe's inputs are deliberately discarded.** It found its distinguishing input for
`hr = 60000 / mean(a)` by calling `classifyRecording([1, 2, 3])` — RR intervals of one to three
**milliseconds**, which the function faithfully reports as *"mean HR 30000 bpm"*. Asserting on that
would be true, stable, and would encode that behaviour on impossible input must never change: a
change-detector wearing a test's clothes, failing on refactors and passing on defects. The *mutation*
is real, so physiological inputs were re-derived that kill the same mutants. **A mutant tells you
which line matters, never which input to assert.**

**The one worth reading twice:** `hour`'s guard is `t0Ms != null && isFinite(t0Ms)`. As `||`, a null
`t0Ms` passes — `isFinite(null)` is **true**, because `Number(null)` is 0 — so `hour` becomes **0**
and a recording with no clock reads as starting at midnight, then falls into the `hour < 11` morning
branch. Absent time rendered as a specific, plausible time: the Clock Contract §2.6 shape, with a
downstream consequence. The current code is correct; **nothing asserted it**, so it was held off by a
single unasserted `&&`.

That is the same shape as the PpgDex `cvhrIndex` fix — there a fabricated `0` where `null` was owed,
here a fabricated `hour 0`. `0` is JavaScript's fabrication of choice for absent quantities, because
so many coercions produce it: `Number(null)`, `Number('')`, `Number(false)`, `+[]`.

**Verified by planting, not by passing.** All six mutations were applied and each was caught by 3–9
assertions: the ms→bpm constant (7), the absent-clock `&&`→`||` (3), the rate-OR-rise `||`→`&&` (9),
both confidence constants (3 each), and the morning/spot `&&`→`||` (5). The morning/spot pair differs
in **duration only**, both at 09:00, so an `||` shows up as one case changing class and nothing else.
