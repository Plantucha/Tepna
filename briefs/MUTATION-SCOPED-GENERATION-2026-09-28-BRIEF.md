<!--
  MUTATION-SCOPED-GENERATION-2026-09-28-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED · **Created:** 2026-09-28 ·
**Residue:** 2026-09-28-mutmut-generation-cannot-be-scoped-to-the-diff

# A diff-scoped gate should not generate 20,021 mutants to run 242

**SIZED ON PAPER, NOT BUILT.** This is owner option (f) from the 2026-09-28 `mutation (diff-scoped)`
decision, written up so the cost and the one real risk can be judged before anyone spends a day on it.
Nothing here has been implemented. Every number below was measured while diagnosing #3202 and #3208; the
design is a proposal and is marked as such throughout.

## The measurement that motivates it

`mutmut run <glob>` applies the glob when it **runs** mutants, never when it **generates** them
(`mutmut-3.8.0/__main__.py:114`):

```python
def create_mutants(max_children):
    with Pool(processes=max_children) as p:
        for result in p.imap_unordered(create_file_mutants, walk_source_files()):
```

`create_mutants` walks every source file and takes no name filter. So a five-line diff inside one function
of `capture.py` generates the module's whole population before the first mutant runs:

| | |
|---|---|
| mutants generated for the module | **20,021** across **226 functions** |
| generated file | **562,427,047 bytes**, 7.05 M lines |
| mutants the diff actually needs (`x_alert_poller`) | **242** — 1.2 % |
| the module's own largest function (`x_run_oxyii`) | 2,539 mutants, all generated for a diff that touched none of it |

**What that cost in practice** (#3202, run 36465603809): the required job spent **9,356 s inside
generation and never finished it**, decided **zero** mutants, and was cancelled by the runner's 180-minute
cap with no verdict at all. The proof it never left generation is an absence with a known emitter —
mutmut prints `done in {ms}ms (N files mutated…)` the instant `create_mutants` returns, outside its
suppressed spinner block, and that line occurs **0 times** against 618 spinner lines.

#3208 made that phase bounded and named (`NOT_RUN phase: generation`), which turns a 180-minute silent
cancellation into a refusal in minutes. **It does not make the work smaller**, and this brief is about the
work being smaller.

## Why the other options do not reach this

Recorded so the owner does not have to re-derive it:

- **Sampling (option b, a pre-stated stride over mutants)** changes which of the 242 mutants RUN and not
  one byte of the 20,021 that are generated first. It cannot touch the failing phase.
- **A bigger or self-hosted runner (option e)** does not either, and is separately bounded by memory:
  measured, a single process importing the generated module peaks at **≥ 8.78 GB** (VmHWM 9,207,712 kB,
  against 45 MB for the unmutated `capture.py`) — so the per-worker cost is the module, and
  `workers_that_fit` affords **0 workers on a ~14 GB hosted runner**, 2 on the 33 GB rig, 0 on the 15 GB
  capture box. Nothing about *which* machine changes 562 MB × ~16.
- **Per-file scoping, which mutmut does offer** (`paths_to_mutate` / `do_not_mutate`), is useless when the
  diff is inside one file — and capture.py is one file.
- **`mutate_only_covered_lines`**, which mutmut also offers, trims by coverage rather than to the diff.
  Worth measuring as a cheap partial win (see Open questions), but it is not scoping.

## The proposal: a POST-PASS on the generated tree, keeping the module whole

Kestrel's framing, 2026-09-28, and it is the part that makes this safe:

> generate the module with ALL code verbatim and mutant branches only inside the scoped functions — a
> post-pass on the generated tree so unscoped functions collapse back to their original body.

Concretely, after `create_mutants` and before the first mutant runs, rewrite `mutants/<module>.py` so that
for every function **not** in the diff's scope:

- its `x_<fn>__mutmut_<N>` variants are removed,
- its `mutants_x_<fn>__mutmut` dict is emptied (or the `@_mutmut_mutated` decorator dropped), so the
  public name binds the original body directly,
- `x_<fn>__mutmut_orig` and the public `def <fn>` are left exactly as generated.

**The tests still import the same module.** Every function is present, with its real body; only the mutant
*branches* of out-of-scope functions are gone. A kill or a survival therefore remains a statement about
the module the suite actually exercises — which is the whole fidelity question, and it is why the
"generate only the target function into a reduced file" idea is the wrong shape: **the generated file IS
the module under test**, so shrinking its contents changes the artifact the verdict describes.

### What must hold for the post-pass to be honest

1. **The module still imports and the baseline still passes.** A rewrite that breaks an import reports as
   mutants "not checked", which reads as a clean run with no survivors (`mutate_diff.py` §3 already
   guards this by counting DECIDED mutants; that guard is the acceptance test here).
2. **In-scope mutant numbering is untouched.** mutant ids are positional per generation, so a post-pass
   that renumbers anything silently invalidates every survivor comparison across runs
   (measured 2026-08-03: a deleted baseline scratch produced "14 regressions" in `run_polar` that did not
   exist).
3. **The reduction is asserted, not assumed.** Before/after mutant counts per function, with the in-scope
   count identical and every out-of-scope count zero.
4. **The scratch cache key must change.** `mutate.py` keys its reusable scratch on the module's source
   hash alone; a scratch generated under one SCOPE is not reusable for another, so the key has to include
   the scope or the second run silently reuses the first run's reduction.

## Acceptance

- `x_alert_poller`'s 242 mutants are generated and decided; the other 19,779 are not generated.
- The clean baseline inside the reduced tree passes, and `mmeta.tested_count` reports 242 decided — not 0.
- A control: the same function mutated with and without the post-pass yields the **same killed/survived
  sets**. If any mutant changes verdict, the post-pass has changed the artifact and the unit stops.
- Generation wall time and peak RSS recorded for capture.py on the rig, so the owner can see whether a
  hosted runner becomes viable. **Predicted** ~1.2 % of the file, hence a per-worker cost of ~100 MB
  rather than ~8.8 GB — but that is arithmetic from the measured factor, not a measurement, and the unit
  must report the real figure.

## Risks, stated rather than discovered later

- **A rewrite of generated code is a new instrument.** It needs its own known-answer test (a small module
  with two functions, one in scope, one not) or it becomes a second thing that can silently produce
  "no survivors".
- **mutmut's generated shape is not a contract.** #3208 already found one behaviour nobody had written
  down — `@_mutmut_mutated` keeps the ORIGINAL defaults on the visible `def` and dispatches at call time,
  so a signature-reading assertion cannot observe a mutated default
  (`2026-09-28-a-signature-reading-test-cannot-observe-a-mutated-default`). A post-pass that pattern-matches
  the generated file inherits that fragility, and the mutmut pin in `pyproject.toml` becomes load-bearing
  in a second way. **An upgrade must re-run the known-answer test before anything else.**
- **It does not fix the function-scope debt.** The gate mutates the whole function you touched
  (#1761: a 24-line insertion produced 141 survivors, 62 of them log-message text). Scoped generation makes
  a one-function diff affordable; it does not make a 2,539-mutant function affordable. `x_run_oxyii` and
  `x_run_polar` remain out of reach and that is a refactor question, not this one.

## Open questions for the owner

1. **Is the cheap partial win worth measuring first?** `mutate_only_covered_lines` is a mutmut option, not
   a new instrument, and it may cut generation substantially on capture.py. Unmeasured. It is not scoping
   and would not make the gate diff-scoped, but it might make it *finish*.
2. **Should the post-pass live in `mutate.py` or upstream?** A patch to mutmut would serve everyone and
   costs a fork; a post-pass here is ours to maintain and pins us harder to the generated shape.
3. **What happens to the committed size record?** `tools/mutation-sizes.json` is keyed on
   `(module, source hash)`. Under scoped generation the size depends on the SCOPE too, so either the key
   grows a scope component or the record stops describing what will be generated.
