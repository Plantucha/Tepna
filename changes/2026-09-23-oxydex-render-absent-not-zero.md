---
bump: patch
type: fixed
brief: none
---

OxyDex per-night charts drop a night with no computation instead of plotting a real 0. Seventeen sites of one shape returned 0 when the metric container was absent, which discarded a null the DSP had published on purpose - sbii and pred3p refuse by construction when there are too few samples, and the self-ingest containers default to null - so the producer said not measured and the renderer drew a number over it. A 0 is not neutral on these axes: it reads as a perfect night on ODI-4 and hypoxic burden and as the worst possible night on a 0-100 stability or stress score. The shared renderer already drops absence, so the fix is null and no consumer changed. Four further sites of the identical shape are deliberately untouched because the survey refuted them as unreachable, and the new scan is keyed to which containers are nullable rather than to a count or line numbers, with an anti-vacuity leg asserting it still matches the exempt sites. Seventeen rows of ABSENCE-SURVEY-2026-09-22, all 21 sites judged with none unjudged. Export-inert as computed: manifestHash moved, computeHash untouched, so no verifiedUnder was owed, though OxyDex is a carrier node whose embedded stamps still needed regen.
