---
bump: patch
type: added
brief: MUTATION-PIPELINE-INTEGRITY-2026-08-24-BRIEF.md
---

`briefs/MUTATION-PIPELINE-INTEGRITY-2026-08-24-BRIEF.md` — six defects found in one day in a pipeline
every gate called healthy, recorded together because **they chained**: each hid the next.

**The innermost made everything look finished.** `journalVerdict` tested `!lastN` before `hit`, and a
seed-pool kill sets `hit` while spending no tier — so **1271 kills per run** were journalled
`NOPROPOSAL` and discarded. Nothing new reached the journal, so the distill output came out
byte-identical to the previous day's apart from one date digit, the candidate count sat at exactly
**1516** for three consecutive runs, and the tool reported *"probe converged"*.

⚠️ **Converged and amnesiac are indistinguishable from outside** — both produce a stable number, and
the discriminator is not the count but whether it *should* have moved.

**The outermost produced a fabricated diagnosis:** *"the source moved since the crawl"* about files
with **zero commits** since their crawl, which had already cost a planned four re-crawls that were
never needed. A tool may name only what it actually checked.

Two of the six left a **dead branch naming the exact case its own guard order made unreachable**
(`poolHit ? 'pool'`, `both threw`) — a searchable signature, and how both were found.

§5 records what caught them, since **not one gate fired**: every one was a number that should have
moved (1271 kills vs 0 log lines; 165 records vs 0 carrying `after`). The decisive experiment changed
**nothing at all** — when two explanations both predict improvement, only the null run discriminates.

§6 carries five open items, each either deferred with a measured reason or left explicitly unexplained
rather than guessed.
