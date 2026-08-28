---
bump: minor
type: added
brief: MUTATION-ACCOUNTING-LOOP-2026-08-27-BRIEF.md
---

`mutate.mjs --only <list.json>` — re-test a **recorded mutant list** instead of sweeping the file
(§E4b, the cheap path of §E4's re-examination lane).

§E4 closed the *"skipped forever"* hole by re-**sweeping** a file whose `testsHash` moved. Correct, and
it overpays: on `hrvdex-dsp.js` the sweep tested **490** mutants to learn about **171**, and all 8 that
moved were survivors by construction — a mutant already killed by the old suite cannot become a
survivor under a better one.

## Verified against a real oracle

§E4 left a full generation-1 → generation-2 sweep on disk, so the answer was known before the shortcut
ran:

| | mutants | KILLED |
|---|---|---|
| full sweep | 490 tested | **8** movers |
| survivors-only | **171** judged | **8** |
| set difference | | **0 either way** |

Mutant for mutant, not count for count.

## 🔴 The saving is ~3× smaller than the counts imply

Like-for-like, both with `--bail` as the crawl runs it: **35 % of the mutants took 70 % of the time**
— 3 m 12 s against 4 m 35 s. (Without `--bail`, 2 m 41 s = 59 % — the flattering number, and not the
crawl's configuration.)

The mechanism is structural and generalises to any survivor-scoped work: **a killed mutant exits at its
first failing group; a survivor runs all 27.** The sweep was 326 cheap kills plus ~164 expensive
survivors, and the shortcut deletes exactly the cheap half. ⚠️ Note the direction — `--bail` makes the
baseline's kills *cheaper*, so it makes the shortcut save **less**: 59 % → 70 %. Quote the measured
ratio and the mechanism, never the count ratio.

Verdicts are bail-independent and were re-checked under both: 8 killed, exactly the 8 movers, in each
run. Bail changes how many groups run *after* the first failure, never whether one failed.

## It refuses rather than guessing — three modes, each naming its cause

`line \0 op \0 before` **is not unique**: `pulsedex-dsp.js:197` carries two `num → 0` mutants with
identical `before`, and in 2026-08-25 a draft fused one mutant's input with the other's output and
reached `main`. `after` disambiguates and, unlike an index, does not shift when code above is edited.

- an entry that cannot name ONE mutant → **MISS**, nothing selected;
- a 4-field key still matching two → **AMBIGUOUS**;
- an entry matching nothing → the **source moved**, so sweep cold — which is what §E4's `crawlPlan`
  already decides on a moved `srcHash`. The interfaces agree by construction.

Any of the three refuses the **whole run**. The shortcut's product *is* the denominator, so every way of
silently getting a smaller one must be loud: a partial re-test and a complete one look identical in the
output, differing only in a number nobody can check.

⚠️ **`--limit` is forced to `Infinity` under `--only`** — its default 60 would have quietly thinned a
171-survivor list to 60: a smaller denominator reported as a complete answer, inside the very flag built
to prevent that.

**12 new selftest assertions**, including both null-control directions — the complete list selects every
mutant and refuses nothing, and a duplicated entry does not double-count.
