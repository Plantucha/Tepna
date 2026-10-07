---
bump: patch
type: fixed
brief: none
---

condPctBelow94 divided a measured numerator by the full sample count, so absences inflated the denominator and the percentage under-reported (5.6 against a true 6.3). computeGatedNadir compared spo2 against Infinity, where null is less than Infinity, so one absence made the nadir null — and the guard missed it because the global isFinite(null) is true.
