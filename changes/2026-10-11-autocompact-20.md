---
bump: patch
type: changed
brief: none
---

**Sessions compact at 20 % of the context window instead of near its end** (`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=20` in the project settings' `env`).

Owner, 2026-10-11 ("spend tokens to save tokens"). Measured on the fleet's own transcripts for 2026-10-11 (four sessions, ~3,300 assistant turns): the context read on every turn averaged 410k–607k tokens and two sessions never compacted all day; one compacted once, at 966k, back to 125k. Every turn re-reads the whole window and every cache expiry rewrites it at write price — 81 % of the day's fresh tokens were such rewrites. Capping the window at ~200k cuts the mean per-turn read by 51–67 % on the same work. The variable only lowers the trigger (values above the default are ignored) and takes effect when a session starts. A fleet lesson, not a code change: no bundle moves.
