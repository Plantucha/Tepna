---
bump: minor
type: added
---

**`VIGIL-OVERNIGHT-FINDINGS` §P2.4's missing half: the morning QC digest.** Coverage was *"computed but not
surfaced … it is the number that matters"* — the compute half shipped long ago (per-stream `coverage_pct`,
per-device QC coverage, a monitor render), but the only push channel was the missing-stream alert, which
fires **only when something is wrong**. A good night said nothing. Now, once per local day
(`qc.digest_hour`, default 9, `-1` disables), the proven webhook carries:

    night 2026-08-18 — O2Ring 63%, Verity 41–95% · no data: COOSPO · missing: Verity:ppi

Formatting decisions that are load-bearing: **a range when streams diverge** (41 %/95 % must never read as
68 %), absent-coverage devices **named rather than averaged in as zeros**, and an empty night sends
**nothing** — an unconditional sender with no content check is the vacuous twin of the alert it complements.

## The gate caught two defects before this shipped, one of them mine in a test written hours after the rule

- The default `digest_hour=9` made three pre-existing alert-path tests **time-of-day dependent** — green
  before 09:00 local, red after. They now pin `digest_hour: -1`, with the reason in a comment.
- **My own DENY test was partially vacuous**: two `_run`s in one test, the first left `_STOP` set, the
  second executed **zero ticks**, and `sent == []` passed while proving nothing. The uncovered
  `_line`-falsy branch is what exposed it. Rebuilt as two tests over a shared harness that returns a poll
  counter, with `polls > 0` asserted — the failure is documented in the harness docstring so it stays
  caught.

Gate: `pytest --cov --cov-branch --cov-fail-under=100` → **100.00 %**, 3912 passed, `capture.py` and
`nightqc.py` both 0 miss / 0 partial. ruff clean.
