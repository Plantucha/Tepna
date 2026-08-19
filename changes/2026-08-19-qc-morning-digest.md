---
bump: minor
type: added
---

**`VIGIL-OVERNIGHT-FINDINGS` §P2.4's missing half: the morning QC digest.** Coverage was *"computed but not
surfaced … it is the number that matters"* — the compute half shipped long ago (per-stream `coverage_pct`,
per-device QC coverage, a monitor render), but the only push channel was the missing-stream alert, which
fires **only when something is wrong**. A good night said nothing. Now, once per local day
(`qc.digest_hour`; **code default OFF**, the box opts in at 9), the proven webhook carries:

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

## And then CI failed anyway, which is the finding worth keeping

The first push ran **green locally and red in CI on the identical commit** — local runs happened before
09:00 EDT, CI runs at ≥09:00 UTC, and the on-by-default hour made every test that reaches `qc_poller` with
a notifier **time-of-day dependent**. Pinning three tests was treating instances; the class is the default.
So the code default is **`-1` (off)**, with the measured reason in a comment beside it, and the one box
that runs this opted in via `config.yaml` (`qc: digest_hour: 9`, backup kept). A default whose test outcome
depends on the wall clock is a flake generator, and this one was caught only because CI and the author sat
in different timezones on the same morning.

## And the predicate itself was a re-derivation of a documented bug

The first draft's `now.hour >= digest_hour` floor is verbatim the pattern `cpap_harvest.due_now`'s
docstring records as *"wrong and shipped once"* — a 19:25 restart re-armed a 13:00 job, at a measured cost
of 5–7 dB and 17 reconnects. The tested primitive (bounded window, wrap-safe once-per-day key) sat 300
lines away and the digest didn't inherit it — the same shape as the DSPs never inheriting §2.6.
`qc_digest_due` now **delegates** to `due_now` (window [hour, hour+3)), the 19:25 case is pinned as a test
(`qc_digest_due(19:25, 9) is False`), and the tests pin `_now` to a fixed datetime — the "hour 0 = always
due" shortcut in their first draft was the same wall-clock trap wearing a third disguise (it breaks after
03:00 local).

Gate: `pytest --cov --cov-branch --cov-fail-under=100` → **100.00 %**, 3912 passed, `capture.py` and
`nightqc.py` both 0 miss / 0 partial. ruff clean.
