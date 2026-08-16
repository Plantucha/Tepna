---
bump: patch
type: added
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---

An inventory of assertions that pin a DIRECTION where they might pin a VALUE — the class behind
`_ckAllanSlope`, whose entire least-squares body was deletable because every assertion on it was
`slope < -0.5`. 718 inequality assertions: 123 are tolerances around a named target (already known
answers), **494 are bare bounds**.

⚠️ **The LLM ranking step was tried, measured, and does not work — it is off by default.** Two
15-minute pilots, ~10 min of GPU. The mechanism is fine (494 judged in 4m44s, resumable). The signal
is not:

- **It failed the positive control.** Shown `st.slope < -0.5` — the exact assertion that let
  `_ckAllanSlope`'s fit be deleted — it answered BOUND: *"a computed regression coefficient, not a
  fixed value"*. The test feeds a PLANTED power law, where the slope is exact.
- **Context did not rescue it.** Re-asked with the setup and the theoretical slope values supplied,
  still BOUND, now reasoning that *"numerical precision likely prevents pinning an exact value"* —
  the fit is exact on collinear input, which is how all five mutants were killed.
- **Its three flags were junk**: `isNaN(…)`, an `indexOf(…) < 0` presence check, and `5 - 1.25 > 3`,
  a tautology over literals. 0 of 3 useful, and it missed the known-weak case.

🔴 **The first pilot's poor precision was MY bug, not the model's**, and that is the more useful half.
The pre-filter excluded `Math.abs\([^)]*[-+]`, and a character class cannot cross the inner paren of
`Math.abs(K.pearson(a, b) - 1)` — so 59 already-exact assertions reached the model, which correctly
called every one of them derivable. The model was accurate about what it was shown; it was shown the
wrong things.

Kept because a negative result nobody records gets rebuilt. The deterministic inventory stands on its
own, and a positive control fails loudly if the filter ever stops surfacing the assertion we know was
weak. 12 selftests.

**The published answer is checked coverage** (Schuler & Zeller, *Assessing Oracle Quality with Checked
Coverage*, ICST 2011): the share of executed statements that influence an oracle, via a dynamic slice
from the assertion — one instrumented run instead of one suite run per statement. Not adopted here;
recorded as the direction, and it needs no GPU.
