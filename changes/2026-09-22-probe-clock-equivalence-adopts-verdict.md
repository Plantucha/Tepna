---
bump: minor
type: added
brief: none
---

`tools/probe-clock-equivalence.mjs` emits one `tepna.verdict/1`, keyed on its CONTROLS rather than its survivors: a survivor there is the thing under investigation, so scoring one would convict correct code (the tool's own `if (lo < 0) lo = 0` → `<=` example). The criterion is the soundness gate the tool's header already stated — every control mutant a test killed must be distinguishable by this battery — so `FAIL` means the BATTERY is blind and its equivalence verdicts are void, never that `clock.js` is wrong. Adoption also closed a silent drop: the control loop's `if (r.err) continue` shrank the control set with no record, so a set reduced 14 → 8 by build failures reported `8/8 DISTINGUISHABLE`; those are now named and carried as `excluded` in the population equality. Its `verdict-adoption.json` row moves from a copy-pasted `word-only` exemption to `decides`/`adopted`.
