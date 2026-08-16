---
bump: patch
type: fixed
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---

Three of the four Level-B survivor clusters in `nightqc.x_summarize`, handed over by the QC author
(#1307's advisory mutation gate). The `_pool` near-midnight cluster is deliberately NOT here — it is
theirs, and their night-scoping work lands in exactly that code.

🔴 **Writing the rate fixture found a real defect, not a test gap.** `rate_reality` filed each
measurement under `dev.get("name") or dev.get("model") or "?"` while `summarize` looked it up by
`d.get("name") or d.get("device_id")`. Identical for a NAMED device — and for a nameless one the
measurement is filed under the model and sought under the id, so it is never found and coverage
silently falls back to the **configured** rate. That is precisely the failure `measured_hz` exists to
catch: `polar_pmd`'s SDK-mode trap, where a night records at 55 Hz believing it asked for 176. A
nameless device is a supported shape — `summarize`'s own `or did` fallback is what says so.

Fixed with one shared `_rate_key`, the same reasoning this file already applies to `merge_sessions`
being shared by `summarize` and `timeline.build` "so the two cannot disagree about what the session
is". They had disagreed; the fix is one definition rather than two that happen to match.

**Three boundary fixtures, each landing on a boundary every existing fixture steps over:**
- `span` at exactly `_MIN_SPAN_SEC` — the floor is inclusive, and every existing fixture uses 1000 s.
- `cov` at exactly `_DEGRADED_BELOW`, with rows chosen so the raw ratio is 0.495100: `round(_, 2)` is
  0.5 and not degraded, `round(_, 3)` is 0.495 and degraded. One fixture, opposite verdicts, so
  neither the threshold mutant nor the rounding mutant can hide.
- coverage judged against the MEASURED rate, not the configured one — a device set to 260 Hz
  delivering 130. Needs real device timestamps, so `_cap_timed` was added: `_cap` writes no clock
  column, the measured rate is then unsayable, and the fallback would fire for a legitimate reason
  and pass the test for the wrong one.

**7 of 8 mutants verified killed** by re-applying each individually. The eighth — dropping the
`device_id` fallback inside `_rate_key` — survives because both callers now share the function and
agree whatever it returns. Its real value is stopping two devices with neither name nor model from
both keying to `"?"` and shadowing each other, and **I could not build that fixture in reasonable
time**, so the clause is documented as defensive and UNVERIFIED rather than proven. Removing a guard
one failed to test is not the same as showing it unnecessary.

`pytest` 3797 passed · `ruff` clean.
