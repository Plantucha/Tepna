<!-- SPDX-License-Identifier: Apache-2.0 -->
# Osprey · unit `equivrule` — Kestrel's ruling on the equivalence orphans

**Unit.** Execute Kestrel's 2026-10-28 ruling on the three asks of
`briefs/EQUIVALENCE-ORPHAN-RULING-2026-10-28-BRIEF.md`: delete every orphan, probe the partial
placers, and measure whether a repeat inside one function is a distinct site.

**Branch and worktree.** `claude/equivrule-osp` in `wt-equivrule-osp`, rebased onto `origin/main`.
PR **#4039**, opened as a DRAFT. The code commit is the rebased `c337cb7b9`.

**Exact stopping point.** Both ledger passes have landed, the brief reads DONE, and a second round
repaired the qualifier. CI redded `test (py3.12)` on the python invariant
`test_a_FUNCTION_QUALIFIER_is_unique_within_its_module`, and the fix narrowed the settle pass to
`qualifyPlan`'s own uniqueness condition, so 11 of the 13 re-addresses stay line-keyed and 2 keep a
qualifier.
`tools/mutate-equivalence.json` goes 434 → 401: `--prune --write` deleted 29 orphans, and
`--settle --write` re-addressed 13, deleted 4 and escalated 2. Controls read 0 duplicate identities,
13 settle stamps, a byte-identical round-trip, and a dry `--prune` over the rebased file reporting
`orphansFound: 0` of 401. `node tools/reanchor-equivalence.mjs --selftest` reads
`✓ all 116 selftests passed`.

**Next step.** Read both detached sentinels in the scratchpad — `JS_EXIT=` for `npm run check` and
`PY2_EXIT=` for `capture-host/check.sh` under the primary checkout's interpreter — then ask Kestrel on
board thread 8 to undraft #4039. I never undraft my own. The unit after the merge is the OPEN row
`2026-10-28-two-equivalence-excuses-sit-over-six-sites-one-of-which-the-suite-kills`, by Kestrel's
ruling: measure each of the five surviving sites, then give each site its own entry with its own
argument or leave it a reported survivor.

**Open questions.** Two entries wait on the owner, and they are the whole escalation:
`ppgdex-dsp.js` L485 and L577, both `cmp < → <=` over `for (let i = 0; i < n; i++) {`. The generator
emits that mutation at six sites in five functions; five survive and the suite kills `pearson:2711`.
A cohort of two over five surviving sites is the one shape rule 5 refuses to decide. Row
`2026-10-28-two-equivalence-excuses-sit-over-six-sites-one-of-which-the-suite-kills` holds the
measurement and the two remedies.

**Blockers.** None for the PR. The settle pass costs a real suite run per candidate site, so a repeat
is minutes per cohort rather than seconds — 12 cohorts over 34 sites took about 8 minutes.

**The doc-search query that finds the prior work.**
`node tools/doc-search.mjs --read "an equivalence ledger entry that matches no generated mutant"` →
`MUTATION-EQUIVALENCE-2026-08-04-BRIEF.md:273` for the ORPHANED bucket and
`MUTATION-SURVIVOR-LEDGER-2026-09-28-BRIEF.md:298` for why a key needs content and position.
