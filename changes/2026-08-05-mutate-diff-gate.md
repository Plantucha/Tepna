<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: []
brief: MUTATION-EQUIVALENCE-2026-08-04-BRIEF.md
---
Mutation testing was unaffordable and therefore unused. The JS fleet generates **~11,500 mutants ≈ 150 h** at 20 workers — `oxydex-dsp.js` alone is 2678 — so it got run once per module at most, admired, and abandoned, and almost all of that time went on re-litigating code nobody had touched. `tools/mutate.mjs`'s own header named the bounded form and said it wasn't built. It is now.

**`--diff` mutates only the lines a change touched** and requires them killed — *"if you changed it, some test can see it"*, never judging pre-existing code. Measured on real `clock.js` history: a comment-only commit selects **0** mutants, a small fix **4**, a larger one **31**, against 123 for the file. It is a gate, so it exits non-zero: **1** when a mutant on a changed line survives, **3** when the run proved nothing (canary survived, or a mutant never ran) — passing on an unverifiable measurement being worse than failing on a real one.

**`--bail` stops each suite run at its first failing group.** This is the larger win and applies to surveys too. Every mutant currently pays a full 461 s suite, but ~84 % are *killed* and a kill is decided by the first red assertion. Measured on a real mutant: **289 s → 2 s**, same exit code, same killers. It is safe to add to a shared suite for a structural reason — it is *triggered* by a failure, so it can only shorten a run that is **already red**; there is no input on which it turns a failing run green. A survivor makes nothing fail, so it still pays full price. What it costs is breadth of killer *attribution*, which is why it defaults ON under `--diff` and OFF for surveys.

**The canary still runs in gate mode.** It is looked up against the *full* mutant population, not the diff-filtered one — otherwise a canary outside the touched lines would read `STALE` on every gate run, leaving the fast per-PR gate as the one place with no proof that kills are still detected.

Two traps found by measuring rather than reasoning: a `biome` reformat selected the **whole** 123-mutant population, so the line-diff now uses `-w` (→ 92; re-wrapping still moves tokens, so the gate also prints its **cost up front** instead of letting you discover it by waiting); and asking git for the whole patch died with **ENOBUFS** against a base a few weeks old, so it asks for names first and line-diffs only the mutable files, with an args array because this repo ships paths containing spaces.

`changedLinesFromDiff()` is pure and pinned by **10** selftest cases — deletion-only hunks, count-less hunks, deleted files, multi-file bleed, a path with a space, tab-timestamps. A parser bug here would not error; it would gate the wrong lines, or none, and report a confident green.

**Known sharp edge, stated rather than hidden:** the gate does not yet know which mutants are *equivalent*, so touching a line that carries one reports a survivor nobody can kill. The classification exists as prose in the brief; feeding it in as data is the follow-up.

Tooling + shared-suite opt-in flag only — no shipped source, no `manifestHash` movement, no fixture re-recorded.
