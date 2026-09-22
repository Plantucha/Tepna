---
bump: minor
type: added
brief: none
---

`tools/verdict-adoption.mjs --check` now holds adoption as a **ratchet against the merge base**: any tool `adopted` in `tools/verdict-adoption.json` at `git merge-base HEAD origin/main` must still be `adopted` in the tree — a row that is absent or whose status moved is a red naming the tool, unless the tool's file itself left the tree (retired, not de-adopted). Population is an equality (`adoptedAtBase = kept + retired + deAdopted`); a shallow clone or an unresolvable base refuses (exit 2) rather than comparing against nothing. Closes the class behind the 2026-09-22 near-miss where a whole-file manifest conflict resolved mine-vs-main silently put #2888's `pb-agreement` adoption back to exempt — measured: a revert to `decides`/`pending` is caught by this check and by nothing else in the gate. `--base <ref>` overrides the base; the header carries the companion merge procedure (both deltas from the merge base, round-trip main's bytes before rewriting).
