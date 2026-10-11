---
bump: patch
type: fixed
brief: none
---

Carry the O2Ring's `'- -'` no-reading rows as `spo2`/`hr` null instead of deleting them, so coverage can report an absence the parser used to erase — and make ODI's denominator the measured count explicitly, which it had only equalled by accident, so the published Table 1 figures (17.7 and 33.1 /h) reproduce unchanged.
