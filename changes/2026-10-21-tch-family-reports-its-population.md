---
bump: patch
type: fixed
brief: none
---

Six TCH tools now report the night population each run covered, and each takes its night list from
the snapshot it reports, so one walk serves both. The firmware-reference tool loses the second walk
it kept beside its verdict. The classifier counts a `corpus-scope.mjs` call as an enumeration, so
wiring a tool moves it from `enumerates` to `reports` and never out of the population.
