<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---
Add tools/probe-reach.mjs — which functions a battery actually EXECUTES, as opposed to which ones its
families NAME.

probe-coverage (#1139) answers whether the prober could form an opinion about a survivor. That is a
question about declared `fn` names. Underneath it is a different question with a different fix: which
functions the battery's inputs actually reach.

  reached, not named  ->  register the existing probe under that fn. One line.
  named, not reached  ->  the battery never gets there; needs a new input SHAPE, not a registration.
  neither             ->  write a family.

Measured across the five batteries: 96 functions are already being executed and are not named —
motiondex 28, glucodex 33, cpapdex 14, hrvdex 11, pulsedex 10. On motiondex that covers nine of the
twelve largest invisible clusters; respViterbi was being called 168 times per probe run while its 9
survivors sat unclaimed.

It injects a counter as the first statement of every function body and runs each family's probe once
— exact, and one module load per family. The first version used mutation as a proxy and did not
finish in ten minutes; the direct measurement returns in seconds.

Reached is not killable, and the tool says so: a function can be executed by a probe whose output
never varies with it, which is what the engine's control check exists to catch. This only rules out
the cheapest explanation for a blind family — that the battery never ran it at all.

13 known-answer selftests, including that the instrumented source still parses (an injection that
corrupted the file would report "nothing reached" for everything, which reads like a useless battery).
