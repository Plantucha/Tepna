---
bump: patch
type: added
brief: COHORT-GEN-2.0-PAPER-RERUN-2026-09-15-BRIEF.md
---

Three artifacts claim three different cohort sizes for `treatment-response`, and no two agree. The
published configuration is not recoverable from the repository, so the last re-cut is an owner
decision rather than a measurement.

| source | intervention | flat | total |
|---|---|---|---|
| the paper | 912 | 918 | **1830** (at ≥10 nights) |
| `uploads/treatment-response-results.csv` | 456 | 426 | **882** |
| driving the tool at the paper's stated `nSubj: 900` | 269 | 317 | **586** |

The last row is identical at cohort-gen 1.9 and 2.0 — the generator was already eliminated as a cause.

## What the results file does and does not tell us

**It is untracked** — `git log` on it is empty. It is a local run artifact the repository does not
carry and cannot attribute: evidence that a third configuration once existed, not evidence of what the
paper used.

**One substantive tell:** every one of its 882 rows has `nNights` **exactly 12**, while current runs
produce a distribution. Whatever produced it either fixed the night count or drew from a generator that
did — so the qualification path has changed shape since. That is consistent with the tool drift already
measured on three other papers and is a candidate cause of the count gap. **Not established.**

**One route closed:** seeds in that file span **156 to 59,070** across 882 rows — sparse and hashed,
not `0..N`. So the maximum seed does *not* recover the cohort size. That was the one way the
configuration might have been read directly off the artifact.

The paper's own commit (`437a4791`, 2026-07-08, *"Update project files"*) records no configuration
either.

## Why this is a decision, not more work

The options differ in what they cost a reader, and I won't pick for you:

- **Re-cut at the stated `nSubj: 900`** and publish 586-patient numbers with the discrepancy
  disclosed. Honest, consistent with the other four — but every CI widens, and the paper's own Table 2
  calls ~300/arm the *"minimum acceptable"* tier.
- **Leave the 1830-patient numbers** standing with a note that they do not reproduce.
- **First establish `minNights`** — the paper says ≥10, the tool defaults to 6, and that alone changes
  who qualifies.

Fitting `nSubj` until the counts match remains refused throughout: it reverse-engineers a configuration
from a desired output, and would make the numbers agree while establishing nothing.
