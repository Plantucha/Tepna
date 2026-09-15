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

- Figures/PNGs: this captures **numbers** only.
- Paper text edits and the comparison against published values: the driver produces the left side of
  that comparison; matching it to each paper is the next unit.
- `hrv-confound-analysis.html` publishes no result global — listed as `resultGlobal: null` and
  reported uncapturable, never skipped silently.
- **Three of six paper cohort sizes are NOT ESTABLISHED** (`rmssd-equivalence`, `qrs-yield`,
  `treatment-response`). Recorded as not-established rather than "the papers omit it", because a
  failed grep is not a negative — the brief this serves was corrected for exactly that error in
  #2543. `--paper-scale` refuses those three rather than running them at a size nobody justified.

22 assertions, including both directions of the refusal guard and an inventory check that reads the
real pages, so a stale table reds.
