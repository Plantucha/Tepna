---
name: emit-a-verdict
description: Use when writing or changing a gate, oracle, audit or study that decides something and must emit a tepna.verdict/1 object — the required fields, the seven statuses, the population arithmetic, and the registration step without which the adoption gate reds. Use when adding a status-printing tool, or when verify:verdict-adoption fails.
---

# Emit a tepna.verdict/1

Contract: `CLAUDE.md` §🧾 and `briefs/VERDICT-CONTRACT-2026-09-21-BRIEF.md`. Build it with
`verdict.js` `make()`, then `validate()` the result and throw on failure.

- Status is exactly seven: `PASS · FAIL · SHORTFALL · UNDERPOWERED · NOT_RUN · NOT_APPLICABLE ·
  UNKNOWN`. `NOT_RUN` examined nothing; `NOT_APPLICABLE` examined and the rule does not bind.
- `checked + excluded = eligible`. `PASS` over `checked: 0` or with empty `evidence` is invalid. Every
  non-`PASS` carries a `reason`.
- `criterion` is **pre-stated**. A threshold derived from the data it judges is `UNKNOWN`.
- `producedBy.commit` is a 7–40 hex sha, or null with a `commitReason`.
- **Register it**: add the tool to `tools/verdict-adoption.json` as `decides`/`adopted` with an
  `emits.cmd`, or `verify:verdict-adoption` reds. Give the tool a `--verdict-sample` flag that prints
  the object **alone** — the adoption check parses stdout as JSON.

## Measured

A new gate was green locally and reded `npm run check` at step 28/30 only because no list registered it
(2026-10-11). Then it reded again because the ordinary run prints the object *plus* a human line, which
is right for a reader and unparseable for the checker — hence the separate sample flag.

`npm run check` has a second trap for a new tool: `tools/selftest-all.mjs` needs a **parseable**
assertion count, one of its `SUMMARY_FORMATS`, with the number taken from the run rather than written
as a literal. The alternative — joining `UNPARSEABLE_RATCHET` — is a debt set that may only shrink.

Memory: `control-must-be-a-named-set-not-finds-something`.
