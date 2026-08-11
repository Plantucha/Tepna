<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---
Give extreme-mutate a canary and a CI ratchet, and add `npm run test:tools`.

THE CANARY. A green baseline proves the suite PASSES; it does not prove a mutation is DETECTED, and
those are different claims. The failure it guards has already happened twice in this toolchain: a
worker resolving back to the real repo runs the UNMUTATED file, every mutant "survives", and the tool
reports EVERY FUNCTION PSEUDO-TESTED — which reads as a dramatic finding rather than a broken
instrument. One function known to be noticed is now emptied first and must still be noticed; a canary
that survives VOIDS the run. Learned on first use, verified after. Proven by pointing the canary at a
known-pseudo-tested function: the run refuses and exits 3. Zero noticed functions is likewise treated
as a broken harness rather than a spectacular result.

THE RATCHET. `--baseline` fails only on a NEWLY pseudo-tested function, so CI gates GROWTH rather than
the count. A file absent from the baseline is not gated at all: recording an unmeasured file as `[]`
would assert "nothing here is pseudo-tested", a claim nobody checked, and every real finding in it
would later read as someone else's regression. Wired into the WEEKLY coverage workflow, not per-PR — a
full fleet run is ~8-10 min and would roughly double the merge critical path to re-report a number
that moves only when someone writes a test. The three baselined files cost ~30 s.

`npm run test:tools` runs every tool selftest locally, in parallel, with assertion counts.

⚠️ A CORRECTION, recorded rather than quietly dropped. This work started from the claim that "112+
assertions across eight tools are unrun". That was FALSE — tests.yml has run every tool selftest all
along, greps tools/*.mjs for --selftest, and even refuses a run finding fewer than ten so a tool
losing its selftest cannot read as success. The wrong conclusion came from grepping the workflow for
literal script paths and missing a shell loop: a check searched for in the wrong place, not found, and
its absence believed — the same shape as the failures this toolchain exists to catch. selftest-all
therefore adds convenience and assertion COUNTS (a tool dropping 30 assertions to 3 still reads PASS
in the CI loop), not the gate itself, and its header says so.

Also: the selftest-all "unparseable output" rule was downgraded from failure to warning after it
flagged NINE working pre-existing tools over a formatting preference. The exit code is the contract a
tool declares; a gate that lands red on day one gets switched off, taking the real failures with it.
