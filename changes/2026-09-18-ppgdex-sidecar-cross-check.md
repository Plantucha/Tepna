---
bump: minor
type: added
brief: PPG-ABSENCE-AS-VALUE-2026-09-06-BRIEF.md
---

PpgDex reads the `_PPGRUNS.txt` sidecar and reports it as a SECOND POPULATION — not as a second
opinion. P5 clause 2, which #2531 deferred by name after landing clause 1.

The two producers apply different rules: the sidecar is `rule=stuck` (a constant run at ANY value),
`pinnedSpans` is rail-keyed (a constant run at an observed extreme). Measured on the corpus: of the
61 emitted rows, 8 sit at a rail and 53 are MID-RANGE — 87 % structurally invisible to the rail
rule. The defining case is a 5919-sample (47 second) run at value 100, dead mid-range of an observed
lo=0/hi=200.

So an `agreed`/`disagreed` axis would differ on 53 of 61 rows BY CONSTRUCTION and report a rule
difference as a finding. Those fields are REMOVED rather than renamed; the export now names each
population with its rule, states `rulesComparable:false` outright, and reports overlap as
`coincidentSpans` — geometric only, carrying no claim that one detector confirmed the other.

`sidecarBlind` survives the rework because the threshold question is real and independent: the
writer gates at `min_run=200` while this file recomputes at 5, so a shorter run is one the writer
never examined whatever rule it applied. A file with no rule line has UNKNOWN parameters and is not
interpreted at all.

Precedence is unchanged and still correct: a stuck span IS an absence under §∅ regardless of value,
so the file's spans are taken where the file could see, and below its threshold the recompute
stands.

⚠️ THE GAP IS OURS, NOT THE SIDECAR'S. §∅ says key on RUN LENGTH, never on value membership, because
an in-range value can be a sentinel too — and that 47-second mid-range freeze is the sentinel,
already in the corpus. Widening `pinnedSpans` is a separate unit, deliberately not folded in here.

Also measured, and it kills a reading this PR's first draft asserted: within the rail population the
run-length distribution is CONTINUOUS, not bimodal — 4,392 spans >= 2 over 80.9 M samples, with the
79-199 discriminator band populated at 185. The apparent bimodality was never about length; it was
two rules.

Export-inert without a sidecar, computed not claimed: zero `outputHash` moved, equiv passes.
`min_run=200` is a live capture-side parameter — reported, not changed, no value proposed.
