---
bump: minor
type: fixed
brief: MUTATION-ACCOUNTING-LOOP-2026-08-27-BRIEF.md
---

`tools/mutation-crawl.mjs` — the crawl-level skip is now identity-aware (§E4, closing §3-G3).

`sweepPlan` has always been identity-guarded. The **crawl**-level skip was not: it read
`complete: true` and moved on, forever, however far `tests/dex-tests.js` had travelled. `complete`
meant *"was finished once"* and was being read as *"is still true"*.

**Measured: 29 of 29** complete crawls carry a `testsHash` that no longer matches the suite. Every one
was skipped permanently — including through this week's 159 draft adoptions, whose entire purpose is
converting survivors into kills.

## 🔴 The brief specced a re-PROBE. That is the wrong instrument, and the correction is measured

`probeFile` **never loads `tests/dex-tests.js`**, never runs the suite, and holds zero references to it.
It builds a realm from the **source** and runs batteries — so a probe finding is a property of the
CODE, and a better suite cannot move it. Established by building the specced lane and running it:
`clock.js` and `hrvdex-dsp.js` were both re-probed end-to-end and came back **byte-identical**.

`hrvdex-dsp.js` is decisive — §E3 independently measured that its adoption killed 3 of its recorded
survivors, and the re-probe saw none of it.

**Shipped as a re-SWEEP: correct and expensive.** The acceptance run, on a genuinely stranded crawl:

| | generation 1 | generation 2 |
|---|---|---|
| killed | 318 | **326** |
| survivors | 171 | **163** |
| killable | 11 | 9 |
| probed | 86 | 81 |

**Eight mutants that survived under the old suite are killed under the current one** — precisely the
movement the re-probe measured as zero.

> Route invalidation to the instrument that reads what moved: `testsHash` → the suite runner,
> `srcHash` → the probe/sweep.

## Two more gaps found by wiring it

- **`.crawl.json` records no identity at all** — the hashes live in the `<file>.sweep-state.json`
  sibling, so *"compare the crawl's recorded identity"* had nothing to compare. The lane reads the
  sibling and now **stamps identity onto the result**; a crawl result separated from its sibling was
  unauditable.
- **`survivors` is a COUNT, not a list** — the list is in the cached `<file>.sweep.json`. The first
  wiring passed the crawl record to `probeFile`, which iterates `rec.survivors`; iterating a number
  throws.

## The convergence bug, caught by running it twice

The first version re-examined the same file **forever**: a re-examination stamps the new `testsHash`
onto the RESULT and must **not** restamp the sweep sibling (no sweep happened — claiming one would be a
false record), but the plan read the sibling for *both* hashes, so the fresh value was unreachable.
**Source validity belongs to the sweep; suite validity to whatever last judged.** Null control on real
data: the second run prints `skip clock.js (complete and current)`.

## Guarantees

Generation N−1 is **archived before** N is written — a re-examination cannot destroy its own baseline.
`VOID` files stay excluded and the skip line says why (a VOID file measured nothing; its canary
question is a human's first). Fails **closed**: a complete result whose identity cannot be read
re-sweeps rather than being skipped on trust.

**11 new selftest assertions**, both null-control directions planted: an unchanged identity must still
SKIP, and a moved `testsHash` must not.
