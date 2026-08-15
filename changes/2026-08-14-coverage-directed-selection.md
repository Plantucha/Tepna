---
bump: minor
type: added
brief: MUTATION-COVERAGE-SELECTION-2026-08-14-BRIEF.md
---

Coverage-directed test selection for the mutation sweep — MUTATION-PROGRAM-FOLLOWUPS §6's "the ONE
optimisation worth building before more tests", built and measured.

A mutant on line N can only be killed by a group that EXECUTES line N. `tools/per-group-coverage.mjs`
builds that map (one c8 run per group, in parallel), and `tools/mutate.mjs` narrows each mutant's run
to the groups that touch its line. §6 estimated 10–100×; measured median groups selected of 470:

    integrator-dsp  6  (78x)     hrvdex-dsp  9  (52x)     cpapdex-dsp 14 (34x)
    oxydex-dsp     23  (20x)     ecgdex-dsp 23  (20x)     ppgdex-dsp  30 (16x)

`integrator-dsp` getting the largest factor is the best available outcome: it costs 312.6 s per mutant
against ppgdex's 27.6 s and is ~60 % of the fleet's total cost. Measured end to end, 8 integrator
mutants at 4 jobs now take 339 s wall — of which ~312 s is the fixed calibration run, so the mutants
themselves cost ~25 s against ~2496 s serial under the tag filter.

**THE INVARIANT: SELECTION MAY ONLY NARROW, NEVER WIDEN.** The first version violated it and the A/B
caught it. `tests/run-tests.mjs` loads every DSP before any group runs, so a line executed at MODULE
LOAD is touched by all 470 groups — and expanding to all 470 runs the whole suite against a timeout
calibrated on the narrow tag-filtered run (`baseMs × 5`, ~16 s for hrvdex). The run is killed and the
mutant scored INVALID: never tested, and absent from BOTH the killed and the survivor counts.
Measured on hrvdex at `--limit 24`: identical survivor sets, `killed` 14 → 13, one INVALID at L47.
A load-time line now falls back to the tag filter, so the worst case of the whole mechanism is "no
change", never "wider".

**It can never narrow to ZERO either**, which is the failure that would look like a spectacular
speedup: a run with no groups fails nothing, so every mutant would report SURVIVED — a sweep that
fabricates findings. Every failure path (no map, unreadable map, file absent, line attributable to
nothing) returns null and falls back to the tag filter.

**The canary validates it for free.** `picked.push(canaryMu)` puts the known-to-die mutant through the
same per-mutant path, so a broken selection makes the canary survive and the sweep refuses (exit 3).
The positive control covers the new machinery without a new control being written.

Verified verdict-equivalent, not assumed: hrvdex `--limit 24`, tag filter vs selection — `killed=14`,
`invalid=0`, survivor sets identical, zero disagreements.

Also ships `tools/mutation-reach.mjs`, which splits survivors into UNREACHED (no test executes the
line — write a test) and UNASSERTED (tests execute it and do not notice — strengthen an assertion).
Measured on the surviving sweeps: **UNREACHED 109 (5.9 %) · UNASSERTED 1725 (94.1 %)**. That confirms
FOLLOWUPS §4's fleet-level diagnosis per MUTANT — the suite executes the code and does not check the
result — and it means a coverage floor would buy almost nothing here. Both tools FAIL CLOSED: every
lookup failure resolves to "run it", because over-running costs time while under-running silently
stops testing code and reports the silence as progress.

`--group-index=N[,M…]` addresses groups by the declaration index `--list` already emits. `--group=`
matches title/tag substrings, which is right for a human and wrong for a machine: titles here contain
regex metacharacters and commas, and comma is the filter's own OR separator.

Prior art. Coverage-directed mutant execution is standard, and the Python lane already has it —
mutmut "tests each mutant against only the tests covering the mutated function"
(`capture-host/tools/mutate.py`). This is the JS lane catching up to its own sibling.
  Petrović, G. & Ivanković, M. (2018). "State of Mutation Testing at Google."
  ICSE-SEIP '18, pp. 163–171. doi:10.1145/3183519.3183521
