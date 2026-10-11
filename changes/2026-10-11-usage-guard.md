---
bump: minor
type: added
brief: USAGE-GUARD-2026-10-11-BRIEF.md
---

**`tools/usage-guard.mjs` — what the fleet has spent, measured from each session's own transcript and each API reader run, and what no program here can read, said as UNKNOWN.**

Streams every Claude Code transcript of this checkout (per-message `usage`: input, cache-creation,
cache-read, output, thinking; the last message's prompt size as the context proxy), maps session ids to
bird names through the herder, reads the provider's own usage object out of `gemini-review --out`
records, and judges CONFIGURED budgets only (`--budget <name>=<tokens>`: warn at ≤ 25 % remaining, FAIL
at ≤ 10 %). The plan allowance, its reset and provider spend are reported UNKNOWN with the supported
manual check named; a token count is never presented as a share of the account. One `tepna.verdict/1`
(gate `usage-guard`) beside a `tepna.usage/1` measurement object; `--status-line` reads Claude Code's
statusLine stdin JSON. Adopted in `tools/verdict-adoption.json`.
