---
bump: patch
type: fixed
brief: none
---

PAT coupling refuses times that are out of order, and names the stream, the inversion count and the first
inverted index. It no longer pairs a broken axis. On 2026-09-28 the ring's first minute of pulse feet was
placed up to 6.7 h late by a device-counter reset inside the file (residue
`2026-09-29-ppgdex-misses-a-device-counter-reset`, open). The pairing's single forward cursor then stranded,
and both finger legs "coupled" 6 and 12 of ~23 600 feet, reported as "no overlap or detection failed". Both
legs now refuse with "43 inversion(s), the first at index 2". The three-cornered hat names the leg that
refused and why, instead of "a leg did not couple". Nights with ordered times are unchanged: 2026-09-26
couples exactly as before.
