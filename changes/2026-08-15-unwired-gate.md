---
bump: minor
type: added
---

`find_unwired.py` graduates from advisory to a **gate** in `capture-host/check.sh`, and the reversal is
the point.

It shipped advisory on 2026-08-14 *because* it reported **13 unexplained functions**, every one needing
a human to decide gap-versus-declarative-constant. Failing CI on that list would have trained people to
silence it — the same defect one level up from the one it detects. The curation work is what made
enforcement honest: after the follow-up's §1, the count is **0 on both scans**, and 0 is a floor worth
defending. A new unexplained orphan means something was just added and wired to nothing, caught when it
is cheapest to fix.

A bare run still exits 0 so the report stays readable; only `--check` enforces. The allowlist remains
the escape hatch and every entry must state **why**, so silencing a finding costs a sentence of
justification rather than a flag.

Verified in both directions rather than trusted green: removing an allowlist entry → exit 1; adding a
genuinely new unwired function → exit 1; restored → exit 0.

**⚠️ `CONTRIBUTING.md` gains a case the existing table does not cover.** That table is about running a
*weaker* command than CI. This is its sibling: **the identical command, identical flags, different
answer because of the machine.** Measured 2026-08-14 — `pytest --cov --cov-branch --cov-fail-under=100`
read 100.00 % locally and 99.99 % in CI with every test green in both, because the uncovered branch only
executes where `/usr/local/lib/tepna` exists and is populated. This dev box had been used as a capture
host; CI has no such directory. The actionable half: when CI reds on coverage while every test passes,
look for an environment-dependent branch before looking for a bug.

Closes `CAPTURE-HOST-UNWIRED-MACHINERY-FOLLOWUPS-2026-08-15-BRIEF.md` §2 and §4 — the brief is DONE.
