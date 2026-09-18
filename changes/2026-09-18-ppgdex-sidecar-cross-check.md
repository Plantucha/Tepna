---
bump: minor
type: added
brief: PPG-ABSENCE-AS-VALUE-2026-09-06-BRIEF.md
---

PpgDex reads the `_PPGRUNS.txt` sidecar as a second witness and cross-checks it against the in-JS
derivation — P5 clause 2, which #2531 deferred by name after landing clause 1.

The finding is the headline: the capture-side writer gates emission at `min_run=200` while
`ppgdex-dsp.js` recomputes at `PIN_MIN_RUN = 5`, and §∅ records the O2Ring blanking as 149 runs,
105 of them >= 10 samples, longest 78. 78 < 200, so the sidecar is gated ABOVE the phenomenon P5
exists to exclude. Measured over all 186 sidecars in the corpus: 39 carry any row, 61 rows total,
against 105,612,378 runs detected over 131,338,962 samples examined. One file states it outright —
229k samples examined, 122k runs found, 0 emitted.

That reshapes precedence. "The file wins" is correct and is scoped to what the file COULD SEE: at or
above its own `min_run` the sidecar is authoritative; below it the sidecar is SILENT, not empty, so
the recompute stands. Reading a threshold-gated non-observation as an observation of absence would
delete a real exclusion on 147 of 186 files — §∅ at the precedence layer.

The verdict publishes THREE states plus uncomparable: `agreed`, `disagreed` (both could see it and
differ — the owner's finding), and `sidecarBlind` (below the file's own threshold; not a
disagreement and not an agreement). A file with no rule line has UNKNOWN parameters and is not
cross-checked at all rather than defaulted — 1 of 186 is that case.

Export-inert without a sidecar, computed not claimed: `outputHash` moved on zero fixtures and the
equiv gate passes 201 assertions. `manifestHash` moved because the edit is in the compute closure.
Corpus blast radius: 2 of 119 trio nights carry a sidecar at all.

`min_run=200` is a live capture-side parameter and is reported, not changed.
