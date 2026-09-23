---
bump: patch
type: fixed
brief: none
---

HRVDex's CAMQ returns null when no parasympathetic indicator was measured, instead of a mid-scale 50. With paraCount === 0 the old branch was not merely defaulted but CONSTANT: sympPenalty requires _hf > 0, and an _hf > 0 would itself have incremented paraCount, so the branch could only ever return exactly 50 whatever else the row carried - pinned by a leg that sets _lf = 9999 and still got 50 from the old code. A value that cannot vary with its input carries no information, and 50 is mid-scale on a 0-100 axis, so it drew as an average night on ch_camq. The consumer already filtered v != null, so the point is dropped rather than drawn and no consumer changed. The refusal is narrow: rMSSD alone still scores, HF alone still scores, which keeps it from convicting every ECGDex-ingested row. Row hrvdex-dsp.js:1074 of ABSENCE-SURVEY-2026-09-22 (HIGH). One mutation-derived draft asserted the fabricated 50 as the expected output and was updated deliberately with its reason recorded; two residue rows filed, one for that class and one for the per-node split in whether goldens carry embedded code-identity stamps.
