<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [suite]
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---
Add `tools/probe-equivalence.mjs` — a general equivalence prober with committed batteries, so a classification can be re-checked instead of believed.

MUTATION-PROGRAM §7.1. The only prober in the repo was `tools/probe-clock-equivalence.mjs`, which
hardcodes `clock.js`, its battery and its callable surface — so ~83 classifications measured with a
battery had nowhere to live but brief prose, and the batteries behind them were never committed.

The engine enforces the two rules that make a verdict worth anything, and both fired on the first
real run:

  · A POSITIVE CONTROL MUST LIVE IN THE SAME FUNCTION. Controls are mutants the sweep KILLED, so a
    sound battery must separate them too; any that reads equivalent marks the family BLIND and voids
    every verdict in it. `--emit` refuses outright.
  · A BATTERY PRODUCING ONE ANSWER FOR EVERY INPUT HAS MEASURED NOTHING. A battery returns an ARRAY,
    one entry per input, and the engine counts distinct baseline answers. This is #1052's artefact:
    reading the undefined `PPGDSP.loadOwnExport` made every case throw identically and the run
    reported 0 of 22 distinguishable.

Three defects found by running it, none visible by reading:

  · `functionRange` counted braces without stripping comments and regex literals, so `lombScargle`
    measured L1865–2582 — 588 lines past its end, swallowing six unrelated functions. Nine of its
    eleven "same-function controls" were mutants of code the battery has no business reaching, and
    the family duly reported BLIND. An over-wide family manufactures blindness; an over-narrow one
    manufactures a clean bill.
  · The mutant enumeration was read through a PIPE and truncated at ~146 KB mid-token; ppgdex's is
    ~1.5 MB. It now goes through a file descriptor.
  · The ppgdex battery put the node name at `json.node` where the code reads `json.schema.node`, so
    all 41 inputs took the same refusal arm — 2 distinct answers over 41. Caught by the degenerate
    check, not by inspection. Fixed, and `ppgLoadOwnExport` now separates 11 of 11 controls.

`--emit` never writes a DISTINGUISHABLE survivor: those are real gaps and stay in the denominator.
20 known-answer selftests; no sweep required to run them.
