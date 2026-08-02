<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [Integrator]
brief: CLOCK-MUTATION-AUDIT-2026-08-02-BRIEF.md
---
Closes §5 items 1–2 of the clock audit, and fixes **three** defects in the mutation harness — the third of which invalidated the audit's own re-run.

**The Clock Contract's guards are gated** (19 assertions, 2 groups): §2.1's numeric-epoch plausibility band and §3's locked-order contradiction check. Each guard is asserted as a **rejection AND its adjacent boundary**, because a one-sided test kills the `||`→`&&` mutant and leaves every `<`→`<=` alive — exactly the state the audit found. All seven reported survivors re-applied and confirmed killed, including the sharpest: §3's *day-component > 12* rule, where the mutant lives entirely in the gap between 12 (ambiguous) and 13 (decisive).

*Correction:* the brief first called `clock.js:56` "§2.7's component-range validation". Wrong — §2.7's validator is `_ckMk`, and it **is** gated. Line 56 is §3's file-level lock.

**Tool fix 1 — the mask is regex-aware.** `codeMask()` now lexes regex literals (a `/` opens one only in expression position; inside, `/` terminates only outside a character class). The correction is bigger than removing six comment survivors: mutant generation on `clock.js` moved **81 → 123**, because the desync had also been marking real code as *string* and **suppressing legitimate mutants**. The published 38 % rested on a population wrong in both directions.

**Tool fix 2 — `--dry-run`**, listing a module's mutants without running anything. Proving "no mutant lands in a comment" should not cost 40 minutes of suite execution.

**Tool fix 3 — workers tested `HEAD`, not your tree.** `git worktree add --detach HEAD` checks out the committed state, so every uncommitted change was invisible to the run. It fails in the worst way: silently, with a plausible number, **about the wrong code** — a harness whose whole purpose is *"can the suite see my change?"* was answering about the last commit. It cost a 79-minute exhaustive run that reported seven mutants as survivors which had already been verified killed by hand. Each worker is now mirrored from the caller's dirty files (`git status --porcelain -z`; modified and untracked alike, deletions applied). Verified directly, not inferred: a worker at HEAD contains **0** occurrences of an uncommitted assertion; after `syncDirty`, **1**.

**No before/after rate is claimed.** 41 % and 59 % are measured on different mutant populations (81 vs 123) *and* the second was computed against the pre-fix suite. Neither is a valid pair, and manufacturing one would be the laundered number this brief exists to object to. What is established is narrower and solid: seven specific survivors, each confirmed killed. The authoritative exhaustive rate is owed one more run on a committed tree.

Tests + tools + brief — no shipped source, no `manifestHash` movement, no fixture re-recorded.
