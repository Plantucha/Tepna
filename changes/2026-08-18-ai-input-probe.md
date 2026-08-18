<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: []
brief: MUTATION-SUITE-FOLLOWUPS-2026-08-17-BRIEF.md
---
`tools/mutation-ai-probe.mjs` — the local model proposes an INPUT for a survivor the generic battery
could not separate, and the harness runs it to find out whether it actually separates anything.

**The population this addresses is the large one.** The fleet crawl leaves **5813 survivors with no
known distinguishing input**. They are not known-equivalent: `mutation-crawl.mjs`'s own header is
careful that such a survivor is *"not distinguished by the generic battery"*, which is a different
statement from *"equivalent"* — and it records a case where swapping in a hand-built battery took one
function from 0 to 17 killable. Hand-building a battery per function does not scale to 5813.
Proposing inputs does, because a guess is free when something else checks it.

**Same safety shape as `--draft`:** the model contributes an input and nothing else. It never says
what the code should do, supplies no expected value, and is never believed — every proposal is run
against the real module and the mutant, and only a MEASURED difference counts. A bad proposal costs a
millisecond, not a wrong answer.

⚠️ Model output is parsed with **`JSON.parse`, never `eval`/`Function`**. `--draft` needed a charset
allowlist because a projection must be evaluated; here the model's whole contribution is **data**, so
the code-execution question never arises.

⚠️ **A positive control caught a bug that would have been blamed on the model.** `src.replace(before,
after)` rewrites the FIRST occurrence in the file, which is very often not the mutant's — `before` is
routinely a common line. Replaying inputs the crawl had already PROVED distinguishing detected only
**2 of 6**: two reported "identical output" against a crawl record showing a clear difference, and one
mutant would not load. A probe that mutates the wrong line is indistinguishable from a model that
cannot guess. `mutateAtLine` fixes it and **returns null rather than falling back** to a whole-file
replace, because that fallback re-introduces the bug exactly where it matters.

Measured: **1 newly killable of 30 probed** on OxyDex (110 inputs run) at **46 probes/min**, ~3.3 %
yield. 27 selftests.

Scope note: it refuses files whose source has moved since the crawl (recorded line numbers no longer
address the same code) — today that is `ppgdex-dsp.js` and `hrvdex-dsp.js`, which need a re-crawl.
