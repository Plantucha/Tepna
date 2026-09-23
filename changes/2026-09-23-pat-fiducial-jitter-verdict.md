---
bump: patch
type: changed
brief: none
---

tools/pat-fiducial-jitter.mjs emits its run as one tepna.verdict/1 object, and its adoption row stops claiming it decides nothing about data. It is a measurement: the pre-stated bands (MATERIAL >= 20 ms, INTERMEDIATE 10-20 ms, NOT-DOMINANT < 10 ms) are findings the charter asked for, so no band becomes a status - they ride in result per sample-rate stratum, each SD beside its own sample quantum, as the fixed row 2026-09-05-fiducial-sd-quoted-without-its-sample-rate requires. The criterion is the tool's own hard gate rather than a new one: at least one stratum reporting a within-file SD, where a file needs >= 10 usable beats; the population is in files (given, qualified, excluded), and no qualifying file is NOT_RUN with the counts in the reason. A three-cornered-hat negative variance stays a named refusal in result - never clamped, never a status - because the header says the refusal is itself diagnostic. FAIL and UNKNOWN are reachable from nothing and criterion.name says so. The selftest's hardcoded 15/15 becomes a counted line. WO_CLAIM_RATCHET shrinks 4 -> 3.
