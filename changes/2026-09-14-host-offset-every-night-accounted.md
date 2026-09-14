---
bump: patch
type: fixed
brief: PAT-FORENSICS-WINDOW-REGIMES-2026-08-28-BRIEF.md
---

`pat-host-offset.mjs`'s header says **"REFUSALS ARE LOUD"**. That was true of the four mid-loop guards
and false of the three exits around them, which emitted nothing at all — a file-scan throw, an empty
candidate list, and the overlap precondition. A night that was never evaluated therefore read exactly
like a night that yielded no coupling, and a reader counting rows could not tell them apart.

Measured on `uploads/vigil-archive/captures`: **14 of the 43 nights `pat-per-led` scores produced no
row and no refusal.** The overlap exit took **2026-07-31** — the single SUB-BAR night of
`PAT-FORENSICS-WINDOW-REGIMES` §3, and the only night in that corpus where PAT is measurable at all.
Its H10 records in ~20–30 min fragments, so no ECG×PPG pair spans one 120-minute window. At
`--window 20` the same night scores **6 windows, every one beating its own circular-shift null at
p < 0.05, legacy matchRate 99–100 %**. It was not a weak night. It was the strongest night in the
corpus, dropped for a reason nothing printed.

**This is a selection effect, not a bookkeeping gap, and that is why it is a `fixed` rather than a
`changed`.** Fragmentation means reconnections, which is link quality — the very thing `ppm` partly
measures on a stalled link (CLAUDE.md §🔒 §7 — *"a stalled link can manufacture an arbitrarily large
apparent rate"*). So the silent exit filtered the scored set on a variable **correlated with the
predictor**, which biases every correlation computed downstream. `WINDOW-REGIMES` §8.6 records the
consequence: the clock-offset verdict computed over the surviving nights crosses its own pre-stated
boundary between two 80 %-overlapping trees.

The fix is one invariant rather than three patches: every report routes through a `note()` helper that
also marks the night as having spoken, and a per-night check fires if a night ends having said
nothing. It **fails closed** — an exit path added later that forgets to report is caught by the check,
and names itself *"a BUG in this tool, not a property of the night"* rather than being reported as
data. The overlap refusal carries the best overlap actually seen and the `--window` value that would
score the night, because a refusal a reader cannot act on just restarts the diagnosis.

Re-measured after the fix, whole tree: **46 nights on disk → 29 with a row, 21 with a refusal, 0
silent.** The 13 newly-named overlap refusals are the finding in miniature — `2026-08-15` missed the
120-minute bar by **1.3 minutes** and `2026-08-02` by 10.8, both silently; `2026-08-20` and
`2026-08-23` genuinely have ~0 overlap and now say so.

Gated by a source scan (the night loop is a CLI loop, not an exported surface) asserting the
invariant's **shape** rather than any one exit: `refusals.push` occurs exactly once in the file, inside
`note()`, so a future silent exit cannot report without marking the night. Mutation-verified —
replacing the per-night check with `if (false)` reds it, restoring greens it.

No bundle, no DSP, no `manifestHash`.
