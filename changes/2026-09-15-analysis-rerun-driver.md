---
bump: minor
type: added
brief: COHORT-GEN-2.0-PAPER-RERUN-2026-09-15-BRIEF.md
---

`tools/analysis-rerun.mjs` drives the synthetic analysis tools headlessly and captures the result
object each already publishes — the machinery the cohort-gen/2.0 paper re-cut needs.

Built against `briefs/TOOL-BUILD-STANDARD-2026-09-13-BRIEF.md`: §2.1 search recorded in the header,
§2.2 checkpoint holding **results** rather than a cursor (written after every tool, so a SIGKILL
loses at most the one in flight), §2.4 progress, §2.7 one tier with its absence stated rather than
degraded around, §2.8 serial by default with the clamp justified — each page already runs its own
host-sized worker pool, so N pages at once multiplies a saturating workload — and §2.11 below.

**§2.6, measured not assumed:** `nights-icc-analysis.html` takes **18 s** at the page's 40-subject
default and **~35 min** at the paper's 6,000. The cost is inside the page, which is why the driver
does not parallelise across pages.

## Two findings from building it

**The observability gap hid a correctness bug.** The first version printed nothing between launching
a tool and its completion, and the first real run sat silent for 11 minutes. It was not slow — it was
*structurally unable to finish*: the readiness predicate was `page.evaluate((g) => … window[g] …)`
with `g` never passed, so it polled `window[undefined]` for its full 24-minute budget. Adding the
page's own `#status`/`#progBar` echo (§2.4) surfaced it immediately; the same tool then completed in
18 s. §3.1 of the standard describes this failure and its author still shipped it — the point being
that missing observability does not merely inconvenience, it conceals.

**Every tool defaults to a demo cohort, and re-cutting at that default would have been catastrophic.**
The pages default to 40, 45, 60 and 250 subjects while the papers report thousands — nights-icc
**6,000**, hrv-age-confound **20,000**, cgm-hrv-coupling **6,000**. A naive re-cut would have moved
every number in every paper for a reason having nothing to do with cohort-gen 2.0, and the result
would have looked exactly like a finding. `--paper-scale` writes the paper's size, reads it **back**
off the control rather than trusting the write, and **refuses** any tool whose paper size is not
established.

## §2.11 — declared, not implemented

- Figures/PNGs: **done** for 1:1 canvas→figure tools (`--figures`, staged to `.cache/rerun-figures/`
  rather than written over published artifacts). **Not** done for a composite — `cgm-hrv-coupling`
  publishes three canvases as one image, declared `figures: null` rather than approximated, since
  writing one panel over a composite is silent corruption. Every entry declares the key, so *absence*
  cannot pass for *declared null* (asserted).
- Paper text edits and the comparison against published values: the driver produces the left side of
  that comparison; matching it to each paper is the next unit.
- `hrv-confound-analysis.html` publishes no result global — listed as `resultGlobal: null` and
  reported uncapturable, never skipped silently.
- **Three of six paper cohort sizes are NOT ESTABLISHED** (`rmssd-equivalence`, `qrs-yield`,
  `treatment-response`). Recorded as not-established rather than "the papers omit it", because a
  failed grep is not a negative — the brief this serves was corrected for exactly that error in
  #2543. `--paper-scale` refuses those three rather than running them at a size nobody justified.

## §2.2 and §2.3 verified by doing, not by asserting

The owner pushed back on a compliance claim I had written but not performed. Both are now measured:

- **§2.3** — a 6-tool run was `SIGKILL`ed with 2 units complete. Every owned process was gone on the
  next scan, and the checkpoint held **4180 bytes both immediately and 6 s later**: no orphan writing
  after death.
- **§2.2** — `--resume` reported *"2 tool(s) already in the checkpoint — not re-run"* and finished the
  remaining 4. Result: **6 units, 0 duplicates, 0 re-scored**. What proves the second half is that the
  two pre-kill units carried their *original* timings (18196 ms, 4139 ms); counting units alone would
  not have shown their results were reused rather than recomputed.

## And the verification found a gap in the standard itself

§2.3 said *"identify the process you own by reading `/proc/<pid>/cmdline`, never by a `pgrep -f`
pattern"*. **That advice is incomplete, and following it still produced a self-match.** A substring
test over the whole command line matches any shell whose own command line merely *contains* the tool
name — the scanner, the kill loop, a grep. The `/proc` scan duly reported two survivors after a
successful `SIGKILL`; both were its own subshells, and both had vanished a second later. That is
exactly what reads as "the kill leaked workers".

All three forms of the trap fired in one afternoon: `pgrep -f` took my own shell **twice** (exit 144)
before I switched to `/proc`, and then `/proc` self-matched too. The standard now says to key on
**`argv[0]`** — accept a pid only when argv[0] is the interpreter you launched and argv[1] names your
script, so a shell that mentions the script is excluded by construction rather than by a bracket trick
the next caller has to remember. It ships a four-line snippet.

## Two further limits, declared

- **§2.9** — generic across the six tools (one inventory row each, no per-tool code) but with **one
  caller**. Declared single-consumer rather than claimed generic.
- **One checkpoint path**, so two concurrent runs of this tool would collide: `CKPT` is a constant, so
  a second invocation shares the first's checkpoint and each sees the other's units as done. Found
  while verifying, stated rather than left to be discovered as data loss.

## First real result, and it refutes the brief's own prediction

`nights-icc` at paper scale (6,000 subjects, 35 min):

| metric | published (1.9) | measured (2.0) | |
|---|---|---|---|
| rMSSD ICC₁ | 0.93 | **0.9295** | matches |
| CGM-CV ICC₁ | ≈0 | **0** | matches |
| **ODI-4 ICC₁** | **0.75** | **0.9238** | **moved** |
| nights to clear ICC≥0.80 | **two** | **one** | **reversed** |

Two checks say the run is configured right: `subjects = 5,394` matches the paper's stated 5,394
exactly, and two of three metrics reproduce their published values. Two independent 35-minute runs
gave **byte-identical** ICC values, and all three figures differ from the committed ones.

**The brief predicted "no change — cohort-wide" for this paper and was wrong.** A cohort-wide
*statistic* can be dominated by the stratum 2.0 changed: ICC is a variance ratio, ODI's
between-subject variance largely *is* the apnea spread, and that spread lives in the severe tail. The
paper's own revision note records the same mechanism running the other way from 1.6→1.9 (*"the
AHI-ceiling revision compressed the between-subject apnea spread, so ODI-4 now needs two nights"*);
2.0 raised the ceiling 80→300 and restored it. The inventory's `expect` field is corrected to
`MOVES`.

That the other two metrics match is what separates "a real 2.0 effect" from "a broken rerun" — the
discriminator the brief asked for.

28 assertions, including both directions of the refusal guard, both directions of the scale-mismatch
guard, and inventory checks that read the real pages so a stale table reds.
