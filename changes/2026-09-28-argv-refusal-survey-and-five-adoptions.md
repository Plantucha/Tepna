---
bump: patch
type: fixed
brief: none
---

**Of 45 tools whose no-argument path is provably inert, ZERO could tell an unknown flag from an absent
one.** `tools/argv-survey.mjs` measures it executably and emits one `tepna.verdict/1`; five tools adopt
`tools/argv-guard.mjs` (`analysis-rerun` · `beat-comb-analysis` · `cpap-sa2-agreement` · `pin-coverage` ·
`trio-power-headless`), joining `trio-batch` from #3206.

**The instrument is the defect's own definition, not an exit code.** A token nobody reads is
*indistinguishable from an absent one*, so each tool runs three times — no args, no args again (run-to-run
volatility established **before** anything is compared), then one bogus token — and `IGNORES` is proven by
the comparison. An exit code proves nothing here: nearly every one of these exits non-zero with no corpus.

⚠️ **Naming the token is not refusing it.** The harness's first five positives were all wrong: read by
hand, every one had *consumed* the token as a path — `geometry-probe` printed it as a planted-shape row and
exited 0, `geometry-scan` reported `ENOENT … scandir '--no-such-flag-9f3'` **and exited 0**, and three
crashed with a stack trace. So swallowing gets its own verdict, and it is worse than ignoring: the token
becomes an input name. 38 IGNORES · 5 SWALLOWS · 2 UNDECIDED (a 25 s timeout is never a refusal).

**Arity is the helper's property, not the call's** — two corrections the adoption forced, both now asserted
for every adopter in `tests/dex-tests.js`. `pin-coverage` reads `--dir` and `--limit` through a locally
named `many(…)`/`one(…)` pair, so a scan that knew only `flag`/`opt`/`optAll` saw a 2-flag tool where there
are 4, and a guard built from that table would have refused `--dir`, its one required argument. And
`many('--dir')` is a *bare* call that still consumes the next token, so classifying arity by "was a second
argument passed" put a valued flag in the boolean bucket — the guard would then have refused its path.

**The population is bounded by a proof, not by optimism.** A tool that ignores the token proceeds to do its
job, which is the hazard under investigation and has already cost one corpus write, so the survey probes
only tools with no write, exec or network API anywhere in their transitive local import closure; `--only`
on anything else refuses. `DEX_UPLOADS` is scrubbed, every child is bounded, and `git status` is diffed
around each tool: a tree that moves makes the whole verdict **UNKNOWN** rather than failing the tools.
