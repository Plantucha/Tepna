<!-- SPDX-License-Identifier: Apache-2.0 -->
# Handoff — unit `nsrrpop` (Osprey, 2026-10-28)

**Unit.** The NSRR slice of row `2026-10-21-forty-one-corpus-enumerators-report-no-population`: the
three cohort readers of the SHHS tree publish the records on offer.

**Branch + worktree.** `claude/nsrrpop-osp` in the worktree `wt-nsrrpop-osp`, head `b192224f0`, base
`54089b396`, five commits. DRAFT PR #4080.

**Exact stopping point.** The gate on `52338135c` reded at step 15 of 41 on two legs of my own new test
group, and the fifth commit repairs both. The gate on `b192224f0` reads EXIT=0 over all 41 steps, 14997
assertions over 841 groups. Board thread 8 carries the head report #2055, the two-defect finding #2056 and
the gate verdict #2058. Nothing in the tree is uncommitted.

**Next step.** Read the counted CI waiter's rollup for `b192224f0`, post the per-context conclusions to
thread 8, then wait for Kestrel's undraft. I never undraft my own PR.

**Open questions.** Row `2026-10-28-two-nsrr-readers-are-excluded-where-three-were-debt` stays OPEN:
`POPULATION_EXCLUSIONS` excuses two readers of the NSRR mount while these three sat in the backlog as
debt, and one of the two readings is wrong. The parent row stays OPEN at 25 keys and weight 29.

**Blockers.** None. A peer's ledger append makes the PR CONFLICTING on `briefs/RESIDUE.md` alone, and
`git merge origin/main` joins both appends. `tests/dex-tests.js` conflicts on nearly every parallel PR:
restore the ref's copy, then re-insert the group from the scratchpad file, never keep one side whole.

**The two legs that reded, and why neither was a tool defect.** `blankSampleHelpers` takes MASKED source,
because `classifyTool` masks before it blanks, and its brace matcher walks to end-of-file on the first brace
inside a string or a comment. My leg handed it raw text, which blanked the ODI reader from its sample helper
to the last line, so both real `populationVerdict` calls vanished and the leg reported an absence that was
its own. Two legs in the merged CPAP group passed raw source too and were safe by luck; all three now mask,
and the probe reads the primitive rather than the printed word.

The second leg asserted that each tool
counts the assertions its selftest ran, which `nsrr-stage-validate` does not, and `selftest-all.mjs` records
that tool as a declared member of `UNPARSEABLE_RATCHET`. The leg now reads the ratchet, and a second leg
keeps the debt payable. Row `2026-10-28-the-sample-blanking-contract-reads-masked-source` closes on #4080.

**Doc-search query.** `node tools/doc-search.mjs --read "NSRR cohort reader population offered records
snapshotEntries"`.

**Measured on the real mount, pooled counts only.** Stage-validate 8 records offered, 6 scored, 2 named.
The ODI reader 8 offered, 6 paired, 2 named. The sweep 8 offered, 6 cached usable, then 6 cached against
6 scorable. `npm run typecheck` and `npm run lint` read EXIT=0. `verdict-adoption` reads 289 producers.

**Two defects found on the way, both fixed here.** `discover()` fell through an explicit `--dir` holding
no pair to the default cohort mount and began scoring 5136 records nobody asked about. And `--cache`
wrote its cache unconditionally, so a root offering no record replaced a usable 6-record cache with an
empty one. Both close as `fixed #4080`.
