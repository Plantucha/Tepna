---
bump: patch
type: fixed
brief: none
---
`computeHRNoctDip` invented BOTH of its inputs and then published a clinical-sounding verdict from them. `stats.meanHr || 60` fabricated a reference heart rate and `hrv.hrFloor || refHR` fabricated a floor EQUAL to it, so a night with no HR data computed `dip = (60 - 60) / 60 = 0` and was labelled **"Low (intra-night)"** — not a missing metric but a stated finding about a night nobody measured.

⚠️ **Both fallbacks became REACHABLE because of the §∅ passes that preceded this one**: `stats.meanHr` is null since the stats block was repaired, and `hrv.hrFloor` since #2937 stopped the JSONL re-load synthesising a 0. Fixing a producer moved the fabrication one function downstream, which is why this sweep has to follow the VALUE rather than the file. It is the half-wired shape in reverse.

Absent input refuses. Every consumer already guards with `if (n.hrnDip)` — the CSV, the KPI, the score push and the narrative line — so returning null needed no consumer change. `refHR <= 0` is refused too: `|| 60` had been masking a division by zero.

⚠️ **Three more model-written mutation properties are reconciled**, and one of them was load-bearing in a way the others were not: two asserted the dip LABEL using the input `(1, 1)`, which reached the label ternary only because the function fabricated its way there. Removing the fabrication would have let their `>` → `>=` mutant SURVIVE. They are re-pointed at a night that could exist — floor 54 against a reference of 60, giving dip = 10, where the original reads "Moderate" and the mutant reads "Good" — and the mutant is verified still killed (6 assertions catch it when planted). The third sat in a group titled *"every guard refuses, null never throws"* and was the only member that did not.
