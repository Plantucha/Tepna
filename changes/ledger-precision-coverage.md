---
bump: patch
type: fixed
brief: QWEN-ENGINEERING-PROGRAM-2026-08-27-BRIEF.md
---

**A precision figure without its coverage is not a measurement — and the findings ledger was emitting
one.**

`findings-ledger.mjs stats` reported precision per **lens**. Two ways that misleads, both observed on
`dsp-adversary` while banking the qwen3.8 re-audition (#1960):

1. **It spans model generations.** A re-auditioned lens holds two populations under one key and the
   blended ratio describes neither. Measured: the lens read **0.16**, while its two models read
   **0.75** and **0.00** — opposite-looking numbers averaged into one that matched no lane. A §2.5
   band decision taken on the blend measures the wrong thing.
2. **It hides how little was triaged.** `6/8` and `6/38` both print as a ratio; only the second is
   mostly unexamined. The same lens now reads **coverage 0.05** — the precision beside it describes a
   twentieth of the findings.

**What this deliberately does NOT do is invent the missing verdicts.** The 3.8 re-audition triaged 29
findings, but only 8 were ever written back as ids; the other 21 were recorded categorically, in
prose, and cannot be reconstructed without re-running the audition. Guessing which rows they were
would pollute the metric it was meant to repair — **a false `rejected` deflates precision exactly as a
false `confirmed` inflates it.** So the number is not corrected; it is made to *say* it is partial.
That is the denominator-visible rule this repo already applies to counts, turned on the ledger itself.

`stats()` gains `statused`, `coverage` and a per-`(lens, model)` `models` map. `precision` keeps its
charter meaning and is byte-for-byte unchanged for every existing reader — the additions are additive,
and `addFinding` (the only symbol imported elsewhere) is untouched. `report()` renders the model split
as indented rows and states, above the table, that a lane triaged outside the ledger has its
**audit document** as the authoritative rate.

`duplicate`/`fixed`/`regression` count toward `coverage` but not toward `precision`: those rows were
looked at, and calling them unexamined understates coverage as badly as omitting them overstates
precision.

🔴 **And a bonus finding, which is why this unit's verification was nearly decorative.**
`findings-ledger.mjs` was **invisible to `tools/selftest-all.mjs`** — the runner discovers a selftest
by scanning for `has(…)` / `includes(…)` / `argv.indexOf(…)` on the flag, and this tool used
`cmd === '--selftest'`. Measured: **77 tools discovered, this one not among them**, so its selftest —
11 pre-existing assertions, before the 8 added here — had been running for nobody in CI. That is
precisely the failure the runner's own header warns about. Now 78 tools and 19 assertions reported.

**Every new assertion is negative-controlled against the old implementation**: reverting `stats()` to
its lens-only form produces **6 named failures**, so each one is proven to discriminate rather than
merely to run. The decoy is deliberate — the two models in the fixture are given *opposite* outcomes,
because same-outcome models would pass under both implementations and pin nothing.
