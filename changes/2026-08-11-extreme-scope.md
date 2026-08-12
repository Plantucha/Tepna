<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---
The scope is part of the finding — "0 executions" was true of a group and false of the suite.

A prediction check refuted me, and the refutation is the useful part. hrvdex `fmtClock` / `fmtDate` /
`fmtDateTime` read ZERO executions under `--group=hrvdex-dsp`. They are executed 2 / 2 / 1 times — by a
group named `Clock Contract §5 …`, which that filter does not select. The filter scopes by the FILE's
name; the tests that reach a file are named after the CONTRACT they pin.

So the number was TRUE, of a scope nobody had stated. `notCovered: 20` reads as a fact about the code;
it is a fact about the measurement. The JSON key is now `notReachedByGroup`, the old `notCovered` alias
is GONE rather than kept for compatibility (keeping it is the hazard), the run prints `scope`, and a
partial reach prints an explicit UPPER BOUND warning.

Scoping coverage and mutants to the same group stays right — classifying against tests that never ran
would be worse — but the kill verdicts inherit the same bound, and that has to be said out loud.

NON-VACUITY, FAIL-CLOSED: if the selected group reaches nothing at all in the file, the honest answer
is "not measured", not "0 covered". Refuses with exit 3. The canary usually fires first — a learned
canary is a function in this file, so a group reaching nothing also fails to notice it (I tried to
demonstrate the new guard with `--group=docs-ledger` and got the canary refusal instead) — but a canary
is LEARNED on the first successful run, so a new file's first run has none, which is exactly when a
filter typo is most likely.

Also: c8 now runs via `npx -y c8@10.1.2`, matching how `typecheck` runs tsc. The hardcoded
`node_modules/.bin/c8` worked only where an earlier `--no-save` install had left it and refused
everywhere else — c8 is deliberately not a devDependency (#1163: it desynced package-lock.json).
