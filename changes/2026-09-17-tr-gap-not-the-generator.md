---
bump: patch
type: added
brief: COHORT-GEN-2.0-PAPER-RERUN-2026-09-15-BRIEF.md
---

The `treatment-response` count gap is **not** a cohort-gen artifact. One whole branch of the search is
now closed by measurement.

`2026-09-16-treatment-response-config-unreproducible` recorded that the paper's stated ~900/arm yields
**269 + 317** against a published **912 + 918**, and left the cause open. The obvious candidate was the
generator: the paper filters on a minimum-nights threshold, and cohort-gen 2.0 reshaped the severe
stratum, so qualification rates could plausibly have moved.

**Tested and refuted.** At `nSubj: 900`:

| | published | @1.9 | @2.0 |
|---|---|---|---|
| nIntervention | 912 | **269** | 269 |
| nFlatControl | 918 | **317** | 317 |

Identical at both versions. **The generator changes the qualifying count by 0 patients** — across a
version bump that moved 25 % of all profiles.

So the published configuration is not recoverable by varying the generator. What remains: a different
`nSubj` than the paper records, a different minimum-nights setting, or tool drift in the qualification
path. The tool reports `minNights: 6` at both versions while the paper reports **≥10** — a control its
configuration line never lists, and the only documented discrepancy still unexplained.

**Still not tuned.** Raising `nSubj` until the counts match remains refused for the reason the parent
row gives: it reverse-engineers a configuration from a desired output. What this adds is that the
search space is now smaller *by measurement* rather than by argument.

A second result worth keeping: **this paper's cohort qualification is entirely generator-independent**.
Any future re-cut can treat its N as a fixed quantity rather than re-deriving it per version.
