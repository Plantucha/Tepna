---
bump: minor
type: added
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---

**`tools/run-progress.mjs`** — one shared core for the multi-hour tools: ETA, duration formatting, a
progress line, and an append-only resume ledger. The ETA helpers were written inside `stmt-delete.mjs`
and MOVED rather than copied; a second implementation is a second thing to get wrong, and this one was
already wrong once (it divided by a `jobs` count that bought no parallelism).

**Resume, because two runs were killed partway and lost everything** — Level B at 78/126, then at
102/179. Verdicts are independent per subject, so there was never a reason to discard them.

⚠️ **Resuming across a code change would fabricate results**, which is the one way a resume feature
becomes a correctness bug: a verdict is only meaningful for the inputs that produced it. The ledger
stamps a fingerprint over the subject source and group, and **refuses** a ledger that does not match —
a refusal costs a restart, the alternative costs the truth.

Append-only JSONL is the format for a reason: a kill can only ever damage the LAST line, and `load`
discards a torn trailing line rather than failing. A rewrite-the-file design cannot promise that.

**Wired into both mutation levels, each verified by control rather than by selftest:**
- **Level B** (`stmt-delete.mjs`) — fresh run records 12/12; re-run reports `12 already recorded, 0 to
  go`; a one-comment source change makes it **refuse** and restart from zero.
- **Level A** (`extreme-mutate.mjs`) — gains progress + ETA it never had, plus resume. Its
  short-circuit verdicts (`excluded`, `not-reached`) are recorded too: they cost no suite run, but a
  ledger omitting them reported `1 to go` on a completed run, and a resume message that is wrong about
  what remains is the kind of small lie that makes the feature untrustworthy.

Level A was checked for Level B's sequential bug and does **not** have it — it awaits an async `run`,
so its ETA divides by a job count that exists.

Not yet covered, stated rather than implied: `capture-host/tools/mutate_diff.py` (Python, needs its own
port), the three `regen-*-goldens.mjs` (minutes, not hours), and `mutate.mjs` (already has its own
`--resume`, not yet unified onto this core).
