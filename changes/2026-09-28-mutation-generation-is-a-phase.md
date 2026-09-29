---
bump: patch
type: fixed
brief: none
---

**A required mutation gate burned a 180-minute job, decided ZERO mutants, and the two guards that existed
to stop exactly that both sat behind the phase that failed.** #3202's job never left mutant GENERATION —
proven by an absence with a known emitter: mutmut prints `done in {ms}ms ({n} files mutated…)` the instant
`create_mutants` returns, outside its suppressed spinner block, and that line occurs **0 times** in the
job's log against 618 spinner lines.

**The memory guard could not fire in CI, ever.** It `stat()`s the file that *generation* produces, with a
comment reading *"The generated module exists by now"* — true only on a REUSED scratch. On a fresh one the
size reads 0 via `except OSError`, and `memory_refusal(0, …)` returns `None` for every worker count. Every
CI run is a fresh scratch, so the guard was live only where a warm scratch exists (the box) and dead on the
runner it was written for. **Absence coerced to a neutral number makes a threshold unreachable rather than
making it fail** — §∅ at the guard layer. The refusal it owed in minute one: `projected peak 31.5 GB …
exceeds the 7.0 GB cap`.

⚠️ **The obvious fix — project from the SOURCE size — does not hold, and the data says so:** across 11
scratches, generated/source runs **21.0× (`mutation_pure`) to 657.0× (`capture.py`)**, because generated
size goes as Σ over functions of (mutants × function length). So the size is now **measured or remembered,
never projected** — each run records what it generated beside the scratch, keyed to the module's source
hash — and a run with neither says `workers_basis: "cores (mutants size unknown)"` instead of pretending.

**The worker count is derived, not inherited.** `workers_that_fit` → mutmut's `--max-children`: a hosted
runner (~14 GB) affords **0** workers for capture.py, the rig (33 GB) affords **2**, not the 24
`os.cpu_count()` would have taken. That inheritance is how a 24-core rig and a 4-core runner *both*
over-committed on the same module.

**Generation now gets its own deadline** inside the wall cap, so a phase that eats everything is `NOT_RUN`
naming itself rather than a slow mutation pass wearing `UNKNOWN`. And the clean baseline is reported but no
longer charged to the mutation budget: the effective bound is **7,200 s of mutation after a separately
reported baseline** (1,432 s on the runner, 937 s on the rig — 20 % of the old bound).

Seven plants, one of which **refutes the hypothesis this started from**: a planted grandchild holding the
pipe open after the kill returns in 13.00 s against a 43 s bound, so `stream_bounded` was never the defect.
