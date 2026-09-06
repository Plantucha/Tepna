<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [tooling]
brief: none
---
`npm run check` read doc-search output, which CLAUDE.md §📌 forbids for any gate.

`buildPrompt` interpolated `docContext(fn, file)` inline, and `docContext` `execFileSync`s
`doc-search.mjs` with a 30 s timeout. So `check` → `test:tools` → `selftest-all` →
`dsp-review-qwen --selftest` spawned doc-search and blocked on the loopback bge embedding model —
a **primary-dev-machine-only** dependency that ships with neither the repo nor CI.

Two consequences, and the second is worse than the flake. The selftest timed out at 120 s inside
`selftest-all`'s parallel budget, aborting the 16-step chain at step 6 — twice in one session, and my
first diagnosis of it (box load) was **wrong**: it recurred at load 0.65 at start, 6.22 at the kill,
on an idle box. And the prompt under test had *different content* on this machine than in CI, where
`docContext` fails soft to empty — a gate asserting on a string whose value depends on the box.

Measured with `strace -f -e trace=execve`: **4** doc-search children (12 execve attempts, 8 of them
PATH probing). Four, not the five call sites, because one site is a short-circuiting `A || B` whose
B never runs — PID sampling at 50 ms independently observed the same 4.

`buildPrompt(fn, file, mode, ctx)` now takes the context as a parameter; only the review path resolves
it. `docContext` throws under `DEX_QWEN_FORBID_DOCCTX`, which `--selftest` arms for its whole run, so
any future path that reaches it fails loudly instead of quietly spawning a subprocess. Three
assertions: the guard is live (it throws when armed — a no-op guard would prove nothing), prompts
build with no context and no subprocess, and an injected ctx still reaches the prompt so the parameter
cannot be silently ignored.

Standalone wall **3.79 s → 0.01 s**, `test:tools` EXIT=1 → 0, and the trace shows **0** children.

Also makes the tool's summary parseable by `selftest-all` (`all N selftests passed`, its documented
shape). It previously reported "green (exit 0), but no parseable summary — cannot report an assertion
count": a pass carrying no evidence of how much it checked, which is what lets a tool drop from 24
assertions to 3 unnoticed. It now reads `✓ tools/dsp-review-qwen.mjs  24 assertions`.

⚠️ `OLLAMA = 'http://127.0.0.1:11434'` at `:40` is the REVIEW path and the selftest never reaches it.
The gate's dependency was doc-search, not ollama directly — stated because the obvious reading of the
file is the wrong one.
