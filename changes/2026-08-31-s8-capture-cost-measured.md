<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [tooling]
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---
"`capture.py` is unaudited" invited the next reader to spend a day rediscovering that it is cost-prohibitive.

§8 listed it as unaudited, which reads as *nobody has got to it yet*. It has been got to. The outcome is
a number rather than a survivor list, and the number is the finding.

**Two blockers in two environments, and conflating them cost most of that day.**

**CI's blocker was the gate being unable to SEE the module, and it is fixed** — seven PRs, root cause
#1998: `_all_scripts()` walked mutmut's generated `mutants/` and saw 48 shell scripts where the tree has
24, so the inventory test failed, the baseline failed, and every mutant reported `no budget`. The others
were real defects on the way in: source-scan gate holes (#1982), an unconfigured per-mutant timeout
(#1985), a baseline running a different selection than the mutants (#1992), a refusal naming no test
(#1995), a refusal dropping the assertion body (#1997), and a job resolving the runner's shellcheck
instead of the pinned one (#2000).

**Local's blocker was never the clean run.** Shellcheck is absent locally, so that test SKIPS and the
baseline passes. What remains is pure stats-phase cost: **6 h 54 m still in `Running stats`, output frozen
at 48,409 bytes, byte-identical across FOUR independent runs.** Generation alone is 32.2 min for the one
file. CI, once able to see, hit caps and cancellations at 4–11 h without a survivor list either.

So the gate can now SEE `capture.py` and neither environment can AFFORD to measure it exhaustively. Two
different sentences; only the first was ever in doubt.

⚠️ **The corollary matters more than the cost.** #1954 and #1959 merged with `mutation (diff-scoped)`
RED, and that red was **`REFUSING — could not measure`**, never *survivors exist*. **No survivor list for
`capture.py` has ever existed.** Anything recording those PRs as leaving unkilled mutants is wrong — they
left an unmeasured gate, and there may be no work there at all.

What would change this is the stats cost, not more fixes — the same problem §6-bis's UNION-WITH-TAG
addresses on the JS side, with no Python analogue built.
