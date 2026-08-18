<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---
`mutation-crawl.mjs` threw away hours of completed test execution in three separate ways, and could
not measure the fleet's largest file at all. All four faults were measured on the 2026-08-16/17
crawl.

**A per-file ceiling unrelated to the budget.** `sweep()` hardcoded `timeout: 6 h` while the crawl's
own budget is 48 h. `integrator-dsp.js` ran 717 of 1845 mutants in 354 min, hit the ceiling, threw
`spawnSync node ETIMEDOUT`, and the crawl recorded an error — six hours of test execution discarded.
The ceiling now derives from the budget actually remaining.

**A journal nobody read.** `mutate.mjs` has journalled two records per mutant since it was written
and takes `--resume`; the crawl passed neither, so even that interrupted run restarted from zero
instead of continuing from mutant 717.

**A cache nobody kept.** Resume is per-file on `complete: true`, and a sweep whose PROBE failed
leaves `complete: false` — so the next run re-swept to reach the same failing probe.
`oxydex-dsp.js` re-ran a **193-minute** sweep on 2026-08-17 to fail on `document is not defined` a
second time. A completed sweep is a pure function of (source, suite), so it is now reused when both
still hash the same, and a failed probe costs the probe rather than the sweep.

**RESUMING IS ONLY SOUND ACROSS IDENTICAL CODE**, and `--resume` deliberately does not check — it
replays every recorded verdict, which is right for "the same run continued" and wrong for anything
else. (`--incremental` is the hash-validated mode, but it never reuses a SURVIVED verdict, so on a
survivor-heavy file it re-tests nearly everything.) The crawl therefore supplies the identity guard
`--resume` lacks: it stamps the hashes of the source **and** of `tests/dex-tests.js` beside the
journal, and reuses or resumes only on an exact match. Either hash moving refuses and sweeps cold,
naming which input changed. It fails **closed** — an unreadable source, an absent stamp, or the
unstamped journals already on disk are all refused, because replaying a verdict under code that never
produced it is a fabricated measurement.

**The realm could not load `oxydex-dsp.js` at all.** Line 153 reads
`document.documentElement.outerHTML` while the module body runs, so the probe threw and reported
UNMEASURED for the fleet's largest file — **1477 survivors, more than every other node's survivors
put together**, invisible across two full crawls. An inert DOM stub fixes it: every getter returns an
empty string or null, every method is a no-op. It exists to let a module body finish, not to simulate
a browser — a stub returning plausible elements would let UI code run under the prober and make a
mutant's verdict depend on a DOM this harness invented. That hazard is not theoretical: introducing
`document` made `metric-registry.js:applyTier` enter a branch it had always skipped and write
`body.dataset.mode`, which the selftest caught as `Cannot set properties of undefined`.

**Measured before/after across all nine DSPs**, loading each through the real realm:
`oxydex FAIL → 165 callables`, and **every other file byte-identical** (ecgdex 77, ppgdex 86, hrvdex
72, cpapdex 68, glucodex 50, pulsedex 100, motiondex 46, integrator 76). The first version of that
control was wrong and said so: run from `/tmp`, `ROOT` resolved to `/`, no spine file was found, and
six files read `FAIL` for a reason that had nothing to do with the change.

The reuse/resume decision is a **pure function** (`sweepPlan`), following `land-pr.mjs`'s precedent,
with 12 selftest assertions covering both expensive mistakes — re-sweeping a valid cache costs 193
minutes, reusing an invalid one fabricates verdicts. Four planted mutations confirm they bite;
**one initially survived** (deleting the fail-closed `!now` guard, which `identityDrift` already
refuses via its null check) and is now killed by asserting the refusal *reason*, since the guard's
only observable effect is pointing the reader at the unreadable source rather than at the journal.

Also drops `dex-units.js` from the realm's `SPINE` — it does not exist in this repo and never has
(every load is `existsSync`-guarded, so it cost nothing but a reader's confidence) — and corrects the
comment claiming that list mirrors `dex-coload.js`'s `shared:`, which is `['clock.js']` alone.

Measurement tooling only: no DSP, test, bundle or ledger is touched.
