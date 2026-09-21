---
bump: patch
type: changed
brief: none
---

**`OxyDex.processNight`'s mutating contract is stated at its own signature.** It splices warm-up
edge rows out of the caller's array and rewrites HR values in place — deliberately, so every reader
below sees one trimmed night — but that was documented on `trimSensorWarmup`, and a caller reads
`processNight`'s signature. Residue `2026-09-20-processnight-mutates-its-input`: the NSRR OX-stat
validator masked `rows[i]` after this call and was misaligned on every record the trim touched.

The three other `tools/` callers were read rather than listed as suspects: `nsrr-aai-validate` and
`oxydex-export-staleness` never touch the array after the call; `pb-operating-point` does — and
correctly, since it pairs the SpO₂ distribution with the oscillation episodes counted on the same
trimmed night — and now says so in place. Comment-only, but it sits inside the compute closure, so
OxyDex's `computeHash` moves and both fixtures are re-verified against the corpus and re-stamped.

Fleet-Session: Magpie
