<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: []
brief: TOOL-INVOCABILITY-SWEEP-2026-08-02-BRIEF.md
---
`tools/mutate.mjs` was mutating prose, and the first real sweep proved it.

The line filter skipped lines that *began* with a comment marker, which is not the same thing as "is a comment". Roughly a third of the survivors in the first sweep were mutations of text that cannot affect behaviour:

- a `<` inside a block-comment body whose continuation line starts with a letter;
- a `// 90 min` trailing a real statement (`var EPOCH = 5400; // 90 min` → the **comment** got mutated, not the constant);
- digits inside an HTML string literal.

Those are guaranteed survivors, they are noise — and, worse, **they depress the kill rate**, so the headline number was wrong in the pessimistic direction. Coverage of prose is not a gate hole.

Replaced with `codeMask()`: a single pass marking every character that sits inside a line comment, a block comment, or a string/template literal, with mutants generated only at unmasked positions. It is a scanner, not a parser — it does not know about regex literals, which are rare in these DSPs and at worst reintroduce a little of the noise this removes.

Measured on the same three modules, before → after:

| module | survivors before | after | kill rate |
|---|---|---|---|
| `integrator-tch.js` | 22 | 25 | 45 % → 37 % |
| `oxydex-dsp.js` | 27 | 23 | 32 % → **42 %** |
| `pulsedex-dsp.js` | 27 | 31 | 32 % → 22 % |

The rates move in **both** directions, which is the point: the noisy run was not uniformly optimistic or pessimistic, it was simply measuring a different population of mutants. `oxydex-dsp.js`'s generated count is 2665 — the sample is 40, so per-module rates carry real sampling error and are not comparable to two significant figures.

The selftest fixture was rewritten to exercise the actual capability: a whole-line comment, a **block-comment body on a plain continuation line**, a string literal, and the sharp case — `const EPOCH = 5400; // 90 min`, where the `5400` must mutate and the `90` must not. The old fixture used a bare `*` line with no opening `/*`, which only the discarded line-prefix heuristic could have classified as a comment.

Found by reading the first sweep's output rather than by testing the tool — which is the same lesson the tool exists to teach.
