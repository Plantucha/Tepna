---
bump: patch
type: fixed
brief: none
---

Review fixes (2026-10-08): six items from the safeguards review.

1. OxyDex event continuity: `detectDesatEvents` now tracks missing samples during open events (`evMissing`); `durationSec` excludes them and `missingSec` publishes the gap. Missing time no longer silently inflates duration.
2. OxyDex delta-index: window positions tracked (`winIdx`); only adjacent windows (position diff == 1) form pairs. Gapped windows yield `null` (unmeasured), not a bridged value.
3. Absence regression gate: corrected documentation — the `|| 0` accumulator pattern citing #3359 was incorrect; #3359 fixed null arithmetic, not `|| 0` defaults.
4. PR compliance: `computeHash` body-only changes now trigger the corpus sentence (brace-tracked function body range); `.src.html` added to CODE_RE.
5. XSS gate: escape must be on the SAME line as the `innerHTML` sink; hunk-wide check allowed unrelated escapes to mask unsafe assignments.
6. No-network gate: documentation narrowed to the enumerated PY_FILES (browser cannot recursively list directories).
