<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [suite]
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---
The classification decays because its key contains a line number — add the tool that re-anchors it, and repair the 10 entries #1127 orphaned within hours.

`tools/mutate-equivalence.json` is keyed on `(line, op, before)`. `op` and `before` describe the CODE;
`line` describes where it happened to sit. So ANY edit above a recorded mutant orphans it even when
the mutated line is untouched, and `mutate.mjs` then excludes it as stale — correct, and it means the
classification quietly shrinks toward nothing.

MEASURED, AND FAST: #1127 touched `pulsedex-dsp.js` within HOURS of 19 entries landing. Ten of the
nineteen orphaned, and every one of the ten had an identical `(op, before)` still in the file at a new
line — nothing about the code had changed at all. Half a file's probing lost to a formatting-adjacent
commit, silently.

THE ONLY RE-ANCHOR PERFORMED IS THE UNAMBIGUOUS ONE:

    re-anchor  ⇔  exactly ONE generated mutant in the file has the same (op, before)

More than one match ⇒ AMBIGUOUS, left orphaned. Zero ⇒ the code really changed, left orphaned. Neither
is guessed, because a wrong re-anchor would silently excuse a mutant nobody probed — the one failure
this ledger exists to make impossible. MUTATION-AUDIT-RUNBOOK already records the general version of
that bug: a non-unique anchor relocated a mutation into the wrong function and three mutants read as
survived while the control scored a function the tests never covered.

⚠️ RE-ANCHORING IS NOT RE-VERIFICATION. It asserts only that the identical mutation still exists. If
surrounding logic changed, a `no-distinguishing-input` verdict may now be wrong — and the guard for
that already exists: `mutate.mjs` reports REFUTED the moment an excused mutant turns up KILLED. This
tool moves an address; it never renews a claim.

Applied: pulsedex 10 re-anchored, now 19/19 anchored.

ALSO FOUND, AND CORRECTLY REFUSED: clock.js's three entries — the OLDEST in the ledger, on the file
the whole mechanism was built for — are genuinely GONE. All three recorded lines now hold different
code (`opts.window > 0` became `opts.window > 0 ? … | 0`, `if (span > 0)` became a ternary, `sm[i]`
became `sm[lo2]`). The tool refuses to move them because the code changed, which is the right answer:
those owe re-verification, not a new address. They are `real-gap` records, so they excuse nothing and
nothing is at risk — but the ledger's founding entries had silently gone stale and no one had looked.

8 known-answer selftests on the pure planner, including the load-bearing property that an entry whose
line still holds the same code is never moved even when that code occurs elsewhere.
