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

**The three `regen-*-goldens.mjs` now report progress too**, from one insertion point — they all
delegate to `runRegen`. Reported at the START of each item rather than the end, because the loop
leaves via several `continue` paths (absent fixture, build threw, historical record) and an
end-of-body report would silently skip exactly the items a reader most wants counted.

⚠️ **Resume is deliberately NOT added to the regen tools.** A mutation verdict is a read-only
observation, so resuming one is free; a regeneration WRITES the fixture set, and a resumed
regeneration would leave it half-updated — some files from this code, some from whatever ran before.
That is precisely the mixed-provenance state the resume fingerprint exists to prevent, and these runs
are minutes rather than hours, so the trade is not worth taking.

Still not covered, stated rather than implied: `capture-host/tools/mutate_diff.py` (Python, needs its
own port — though `mutmut` streams its own progress, so it is not fully blind) and `mutate.mjs`
(already has its own `--resume` and bespoke progress, not yet unified onto this core).
