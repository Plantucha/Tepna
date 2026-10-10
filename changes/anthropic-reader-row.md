---
bump: patch
type: added
brief: none
---

**An `anthropic` provider row in the second-reader, and a truncation bug it would have inherited.**

`tools/gemini-review.mjs` gains a fifth row on the Messages API (`x-api-key` +
`anthropic-version`, required `max_tokens`, content as an array of blocks), default
`claude-sonnet-5-5` with `claude-haiku-4-5-20251001` named as the cheap option. `stop_reason:
'max_tokens'` lands in the existing `finish !== P.stop` refusal, so a starved answer is a refusal
and never a score — no second code path.

Also fixed: `reviewVerdict` computed `truncated: finish !== 'STOP'` with **Gemini's literal for every
provider**. Three of the four existing rows complete with lowercase `'stop'` and Anthropic's is
`'end_turn'`, so every healthy non-Gemini reply was scored TRUNCATED against this verdict's own
`truncated_replies lte 0` criterion. The caller now passes its provider's completed value; with none
to compare against, `truncated` is `null` rather than a guessed 0 (§∅).

No run was pointed at the new row: the owner sets the spend limit and decides which of the six
provider rows it replaces. 82 selftests, including that no refusal text ever echoes the key.
