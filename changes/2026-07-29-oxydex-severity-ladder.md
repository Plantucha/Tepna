<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [OxyDex]
brief: MULTINIGHT-CORPUS-FINDINGS-2026-07-29-BRIEF.md
---
OxyDex's clinical impression opened with the words **"Moderate burden" on all 37 nights of the corpus** — including its quietest (2026-07-21: ODI3 0.8/h, ODI4 0.0, T90 0.2 %, nadir 90 %) and its worst (2026-06-15: ODI3 8.7, ODI4 5.2, nadir 84 %, T90 1.0 %). The label was a formatting artifact reading as a verdict.

**The defect.** `Clean night` required `avgScore < 2 && worstScore < 4`, `Mild disruption` `avgScore < 4 && worstScore < 6`. With **28** ranked metrics something always scores 8–10, so both branches were unreachable and everything fell through to the third. Meanwhile `avgScore` — the statistic actually driving the ladder — ranged **1.19 → 5.21**, a 4.4× spread rendered as one word. The `isolatedSevere` flag right below (`avgScore < 4 && worstScore >= 6`, **true on 30 of 37 nights**) was written for exactly this case but only appends a trailing clause after the severity is already floored.

**The decision (owner-ratified 2026-07-29).** The guardrail's intent is kept — never call a night clean while a finding on it is severe — but its strength is reduced: it now floors only on a **10**, a metric at the very top of its scale, instead of on anything ≥ 4/6. An 8 is common enough to be the worst finding on the corpus's *quietest* night, so treating an 8 as disqualifying is precisely what collapsed the vocabulary. The lead finding still opens the clause either way, so a quiet night carrying one red metric reads `Mild disruption: nadir SpO₂ 84%` — the severity word describes the night, the clause names what was found, and neither has to lie for the other. Bands are re-read off the observed distribution (`<2` / `<3` / `<4.5`) rather than left at their original guesses.

**Result over the same 37 nights** — all four rungs now in use, and the three `Significant burden` nights are exactly the highest-burden ones in the oximetry table (HB rate 16.8 / 15.9 / 18.6 %-min/hr):

| label | nights |
|---|---|
| Clean night | 4 |
| Mild disruption | 5 |
| Moderate burden | 25 |
| Significant burden | 3 |

**A fixture output genuinely moved, and the gate is what said so.** `OxyDex_2026-06-25_0439_summary.json` re-reads `Mild disruption: hypoxic load 5.813, …` — that night's `avgScore` is 2.64, which the new `<3` band places one rung below where the unreachable branches had pinned it. The equivalence leg failed on it before anything else did, which is the GATE-C surface behaving exactly as designed; it was then regenerated with `tools/regen-oxydex-goldens.mjs` (never hand-edited), `outputHash a290a0461e828ad6 → 1513466c0031193c`. The sibling `_1056` summary and the synthetic golden are **content-unchanged** — checked, not assumed, since CLAUDE.md requires regenerating all of a node's fixtures when one moves.

**Coverage.** New group (9 assertions) whose headline invariant is **distributional**, because that is the only axis on which this defect is visible — any single night's label was defensible. It drives the real `buildImpression` over the corpus's 37 actual `(avgScore, worstScore)` pairs and asserts more than one label results, all four rungs are reachable, the quietest and loudest nights land on opposite ends, the softened floor still fires on a worst-of-10 while a worst-of-8 does not, severity is monotonic in `avgScore` across 1.0 → 6.0, and the finding still leads the clause.

OxyDex re-bundled (`manifestHash 4c959b483a0e → 5c6ef1923bb9`) plus `docs/`, both orchestrators and the 5 analysis pages inlining `oxydex-dsp.js`. `computeHash` moved `7c9fe8f58829 → 6c96368f7d8a`; `DEX_UPLOADS=<corpus> tools/verify-fixtures.mjs` re-ran the app and re-stamped both summaries → `verifiedUnder: 6c96368f7d8a`. `run-tests.mjs` **4259 green, 0 skipped** against the real corpus, `verify-manifest` GATE A 9/9 + GATE B 15 reproducible, `build --check` clean (11 owned).
