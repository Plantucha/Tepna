---
bump: patch
type: changed
brief: none
---

tools/formula-constant-audit.mjs emits its run as one tepna.verdict/1 object in BOTH modes (the default formula sweep and --descriptions), and its adoption row stops claiming it decides nothing about data. The bar is on the instrument, not the corpus: --descriptions already carried two pre-registered calibration bands (claim-bearing >= 40, flagged rate <= 30%) and refused to publish outside them, so out of band is UNKNOWN naming the band and quoting the tool's own "REDESIGN, not a finding" - not FAIL, because a reader reads the gate name and FAIL would assert the guide constants are wrong, the finding the tool declines to make. FAIL is reachable from nothing; flags are questions and travel in result. The population is in ONE unit (descriptions, or formulas in the default mode): eligible = all items, checked = items with at least one checkable value, excluded = dropped non-claim-bearing plus claim-bearing-but-every-value-refused, so the filter's selectivity is visible in the equality itself - measured on this checkout, 404 descriptions, 26 checked, 378 excluded. WO_CLAIM_RATCHET shrinks 5 -> 4.
