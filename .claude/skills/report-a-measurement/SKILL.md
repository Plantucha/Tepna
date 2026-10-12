---
name: report-a-measurement
description: Use when writing a number into a PR body, commit message, brief, changeset or report — every count needs its population and window, a zero needs to say whether anything triggered, and anything that decides needs a verdict object. Use before claiming a measurement, and when reviewing someone's.
---

# Report a measurement

`CLAUDE.md` §🧾 (verdicts are machine-readable) and §∅.

- **Every count carries its population and its time window.** "233 of 900 candidates, 2026-10-12",
  never a bare 233.
- **Name the tool and the sha** that produced it. A number nobody can re-derive is prose.
- **A zero over no triggers is `NOT_APPLICABLE`, not `PASS`.** A filter that matched nothing
  reports success about something it never examined (§4b) — say what the run examined, not what passed.
- **No number in prose without the thing it changes.** If the measurement moved no decision, say so;
  "unchanged" is a result, not an absent one.
- When the output decides something, emit one `tepna.verdict/1` object beside the prose — see the
  `emit-a-verdict` skill for the fields.
- **Retract in the same place you claimed.** A finding that turns out wrong is withdrawn in the body
  that carried it, never quietly dropped from the next draft.

## Measured

A 21-minute paper-scale re-measure that returned the **same** yield (233 intervention / 239
flat-control over 1,800 patients) was the useful result, not a wasted run: "unchanged" is what proved
a DSP edit had not moved the pinned cohort (#3463, 2026-10-12). Reporting only the digest that moved
would have left a reader unable to tell a re-stamp from a re-measure.

The same follow-up produced a wrong finding and retracted it within the hour: `solMin: 0` reported as
a motion fabrication, when the code derives the field from HR stability and the zero came from the probe's
own constant HR. The session had inferred the derivation from the field's neighbours instead of reading
the loop that writes it — the reason the retraction is in the PR body and not only in a transcript.

Memory: `control-must-be-a-named-set-not-finds-something`.
