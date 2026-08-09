---
bump: patch
type: fixed
nodes: [OxyDex]
brief: OXYDEX-PB-OVERCALL-FOLLOWUPS-2026-08-04-BRIEF.md
---

OxyDex told a night "CS pattern probable (Likely)" — a likelihood asserted twice, from a score that
cannot support it once.

`csLabels` and `uarsLabels` were `['Unlikely','Possible','Probable','Likely']` INDEXED BY A 0-3
INDICATOR COUNT, and the lead string wrapped the result in "probable (…)". The parent brief measured
why the score cannot carry a likelihood: `detectOscillations` has no periodicity test at all — no
cycle-length criterion, no crescendo-decrescendo — and counts crossings of an ABSOLUTE 95 % level, so
on a corpus whose overnight mean is 94.6–96.6 % it tracks mild hypoxemia burden (r = 0.893 with time
below 95 %) rather than the respiratory rhythm "Cheyne-Stokes" names. Night-level agreement with the
CPAP's own PB scoring was kappa = −0.039, worse than chance.

Four surfaces moved together, because a partial edit leaves the guide contradicting the code: the two
label ladders now read "N/3 indicators"; the two lead strings are bare values in the same shape as
their siblings ("CS indicators 3/3", like "AHI est. 14"); the findings-card displayVal follows the
ladder; and the OxyDex guide's "Cheyne-Stokes Probability (0–3)" is restated as an indicator count that
is explicitly not a probability. The score, its 0-3 ladder and every gate on it are UNCHANGED — the
brief's guardrail forbids tuning csScore toward the CPAP's scoring, and §5.2 found no defensible
threshold on this corpus, so retuning would be guessing.

The real corpus caught a regression the first wording introduced: lead and context qualifier became
verbatim identical, so an impression read the same sentence twice. Visible only once
`regen-oxydex-goldens` ran the real night. The lead now carries the count and the context line carries
the caveat, once.

Gated by `oxydex-dsp · pb-overcall · honesty` (9 assertions) — both ladders driven across their full
0-3 range through the real `computePatternScores` criteria, plus a source scan for the lead strings that
is STRUCTURAL rather than word-matched. The first version of that scan keyed on the literal "CS
pattern" and went blind the moment the strings were reworded; only the anti-vacuity count caught it,
which is the argument for making anti-vacuity an assertion rather than a comment. Mutation-verified
against the exact revert: 5 assertions red on the pre-fix ladder and lead.

Fixtures regenerated with the sanctioned tool, never hand-edited (3 moved). Re-bundle reaches four
surfaces, not one: the OxyDex app, five analysis tools, BOTH orchestrators (which `--app OxyDex` does
not touch and which drift-checked red), and the served docs copies. `verify-fixtures` stamped 9
fixtures — the two OxyDex summaries plus seven belonging to other nodes that were already unverified
from earlier merges; those stamps come from a green real-corpus re-run and unblock `release.mjs`, which
refuses to cut a release while any corpus-backed fixture is unverified.

§1's owner call is answered the same day: option 3 — fix the detector so the leg earns its place —
taken over this brief's own recommendation of option 2, and spawned as
`OXYDEX-PB-DETECTOR-2026-08-09-BRIEF.md` as the item required rather than patched in. That brief
carries the spec (baseline-relative crossings, a cycle window that gates the decision, ≥3 consecutive
cycles), the validation design, the "earns its place" bar, and the inherited guardrails.

The validation design is the substantive part, because there is no ground truth: the CPAP is n=1, a
black box, and disagrees at κ = −0.039, so agreeing with it cannot be the acceptance test without
breaking the guardrail that forbids tuning toward it. The bar is construct validity instead — an
adversarial twin pair with identical desaturation burden differing only in periodicity, which the
current detector cannot separate by construction, plus a falsifiable corpus criterion that the r =
0.893 correlation with hypoxemia burden must break. κ is reported beside −0.039 as an observation and
never optimised. And "earns its place" is made measurable: removing the OxyDex leg must change the
fused outcome on some nights, where today 0 of 3 corroborated nights survive its removal — if it still
changes nothing, option 1 becomes correct on evidence rather than argument.

Option 2 is explicitly NOT the fallback if the detector work stalls, because §2 already landed the
honest vocabulary; the surface is no longer overclaiming while the detector is built.
