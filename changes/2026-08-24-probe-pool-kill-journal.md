---
bump: patch
type: fixed
brief: none
---

`tools/mutation-ai-probe.mjs` — **the probe found 1271 kills in one nightly run and recorded none of
them.** A mutant killed by the SEED POOL sets `hit` but spends no sampling tier, so `lastN` stays 0 —
and the guard tested `!lastN` *first*, journalling it `NOPROPOSAL`. The kill was counted in the
summary and thrown away in the journal.

The tell was already in the code: the KILL record writes `tier: poolHit ? 'pool' : tier`, a branch
that exists **only** to describe a pool hit — and the old order made it unreachable. Measured on the
2026-08-24 run: `FROM POOL — no model call` fired **0** times against **1271** reported pool kills.

**This is why the pipeline looked converged.** Nothing new reached the journal, so the distill output
came out byte-identical to the previous day's apart from the date digit, and the candidate count sat
at exactly 1516 for a third run. Not converged — **amnesiac**.

The decision is now a pure `journalVerdict()` pinned by `--selftest`, and the order is stated as the
point of the function: **a KILL is a KILL however it was found.** Whether a tier was spent is a
question about cost, not about whether the mutant died.

**No journal re-classification, deliberately.** `NOPROPOSAL` at `tier < SAMPLING_TIERS` is *not*
terminal under `--retry-none` (verified in the resume predicate, and the overnight script passes that
flag), so the affected mutants are re-probed on the next run, re-killed by the pool in seconds with
zero model calls, and journalled correctly. Recovery by **re-measurement**, never by editing evidence.
⚠️ That self-heal depends on `--retry-none`; a manual run without it treats `NOPROPOSAL` as answered.

**Controls, verified by re-application** — restoring the original guard order fails 2 selftests. Both
directions are pinned: a pool hit is a KILL at `tier:'pool'`, a tier hit keeps its numeric tier, and
the negative twins still record `NOPROPOSAL` and `NONE` so the fix cannot overcorrect into phantom
kills.
