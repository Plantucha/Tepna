<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [tooling]
brief: none
---
`npm run check` reported a verdict about ten steps it never ran.

It was a 16-step `&&` chain, so any failure stopped the shell and everything after it silently never
executed. Nothing in the output named those steps, which makes the honest reading — "one step failed
and N were never asked" — indistinguishable from "the gate failed". That is CLAUDE.md §4b one level
up, applied to the gate that enforces §4b.

Measured 2026-09-05 (residue `2026-09-05-check-chain-aborts-on-load-timeout`): under load 26.74 on a
shared box, step 6 `test:tools` timed out `dsp-review-qwen.mjs` at 120 s — a selftest that takes
**6.7 s** and reports `21 ok, 0 failed` when run alone. The chain aborted there, so `lint`, `test:par`
(the whole suite), `build:check`, `verify:manifest` and six others never ran. It happened twice in one
session, and by the coordinator's count bit three sessions that day.

It was not merely noisy. Splitting the chain by hand afterwards is what surfaced `verify:tools-index`
as **genuinely RED — on `origin/main` as well as the branch**: `tools/find-copied-bodies.mjs` shipped
in #2199 without a regenerated index. The abort had been hiding a real failure behind a timeout.

`tools/run-check.mjs` now runs the same steps in the same order and, on failure, prints the failing
step with its index and exit code, then names every step that did not run and the `npm run` lines to
re-run them. It deliberately does **not** continue past a failure — later steps depend on earlier ones
(`build:check` after the builders) — it only stops being silent.

`STEPS` is the single source of order; the `&&` chain is gone from `package.json` because two copies of
an ordered list drift and no gate could compare them once `check` delegates. The selftest asserts every
entry resolves to a real npm script, so a typo fails loudly instead of never running.

Gated by a plant: forcing step 2 to fail must list steps 3..N. An all-green control asserts the unrun
list is empty, so the reporting cannot be hardcoded, and a probe through the **default** executor
(running a nonexistent script) proves the shipped path is a real runner rather than a stub — an
injected collaborator and an injected no-op are the same syntax.
