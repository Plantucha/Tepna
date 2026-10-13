---
bump: patch
type: added
brief: none
---

**Four house rules read the syntax tree, and every hit on main is allow-listed with a reason.**

`tools/astgrep-gate.mjs` runs `@ast-grep/cli` over four rules in `tools/astgrep-rules/`. They find
`?? 0`, `.get(k, 0)` in Python, `new Date("…")` on a string or a template, and every `Date.parse`
call. The gate joins `npm run check` as `verify:astgrep` and emits one `tepna.verdict/1` object.

The sweep found 68 hits on main and no defect. Every hit carries an entry in
`tools/astgrep-allow.json` under one of nine reasons: a tally, a presence test, protobuf's own
absent-is-zero, a config default, a rate table, an invalid sentinel, a canonical column, a viewport
default, a counted zero. A stale entry reds the gate, so a hit that moves cannot keep its excuse.

Positive controls run on every invocation. The gate plants one matching line and one legal twin per
rule, so a pattern that stops matching cannot read clean.
