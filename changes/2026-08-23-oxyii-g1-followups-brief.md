---
bump: patch
type: added
brief: OXYII-G1-TRANSACTIONAL-SYNC-FOLLOWUPS-2026-08-23-BRIEF.md
---

`briefs/OXYII-G1-TRANSACTIONAL-SYNC-FOLLOWUPS-2026-08-23-BRIEF.md` — the follow-up owed after G1 was
stamped DONE (#1702), carrying what execution deliberately did not close plus two tooling defects
found while gating it.

**G1's own open items** are recorded with their reasons rather than as a wish list: layer-3 semantic
validation (a real JS-parser subset port, which is why `VALIDATION_DEPTH = "size+finalised"` is
written into every row), the physical drop test that sets `resume_strategy`'s single flag, the
`pull_session` wiring, and fsync durability — routed to the chaos lane as a NAMED item because
removing either fsync leaves all 51 tests green, which is a fact about the instrument rather than the
invariant.

🔴 **The two tooling defects are the more valuable half.** `mutate_diff` can return a verdict that is
**not reproducible from its inputs**: the first run after a test is ADDED does not credit it, then
refreshes the cache so the next run is correct — run 6 reported a mutant surviving and run 7 reported
it killed with a byte-identical tree. The evidence self-destructs, which is why it went unnoticed, and
"clearing the cache fixes it" turned out to be a confound that had stood as the defect's founding
evidence. Separately, an entire module can drop out of the gate **while being listed as covered**,
because `run_one` sets `error` for exactly one failure mode and a crashed mutmut therefore counts as a
successful run.

Both fixes are ratified and **held to their controls** — the cache re-key must pass on the FIRST run
after an addition, and the coverage guard must refuse on the induced failure. A shelved
`blind_modules()` is recorded as right-shape/wrong-signal: its selftests pass, planted defects kill
them, and it could still never fire in production.

§5 collects the method findings, each bought by a specific failure — decision-asserted-payload-not (26
mutants survived a 100% statement+branch suite), a boundary test sitting off the boundary, symmetric
loop arms with only one covered, and the absent-side-effect alarm that caught a false green.
