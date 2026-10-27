# Osprey — heavykey (the heaviest unwired corpus enumerator)

**Unit.** Wire the heaviest remaining key of `UNWIRED_BACKLOG` in `tools/corpus-reads.mjs`
(`stage-lab.mjs`, 12 enumeration sites) to a published population verdict.

**Branch + worktree.** `claude/heavykey-osp` in `wt-heavykey-osp`, head `00370bc8d`, two commits on
`origin/main` @ `0d8483222`. PR **#3933**, DRAFT. Board claim #1309, decision #1310.

**Exact stopping point.** PR open with 0 ste-lint findings. The full `npm run check` ran detached on
the final state; the node suite reads 14,259 assertions over 826 groups.

**Next step.** Kestrel undrafts #3933. The next unit is an OPEN row of `briefs/RESIDUE.md` in the
mutation-and-analysis lane, claimed on board thread 7 first.

**What the unit found.** The key was unwirable for a measured reason. `snapshotNights` walks a root
for `YYYY-MM-DD` directories, and a PSG archive holds `ucddb002.rec`, so the night snapshot answers
`ok: true, n: 0`. Wiring the lab to it would have published a whole dataset as a population of zero
under a PASS. The fix gives a population its unit: `snapshotEntries(root, { list, unit })` takes the
caller's own lister, `populationVerdict` derives its criterion and its prose from the unit, and
`notCovered` holds the removal arithmetic once.

**Open questions.** Three `nsrr-*` backlog keys have record-keyed roots and owe the owner a decision
about which population a cohort adapter should publish. Raised as #1254 and not yet answered.

**Blockers.** None for the next unit. #3933 needs no corpus: its proof runs on a planted root.

**Lesson worth carrying.** A generalization that reads one key in five places and patches four is
invisible until a control fires. The empty-population branch of `populationVerdict` still read
`before.nights` after the rest moved to `membersOf`, so a two-record snapshot fell through to
`NOT_RUN` with a null result. The planted control caught it; no selftest written before the
generalization would have.

**Doc-search query that finds this work.** `heaviest unwired corpus enumerator key night population
wiring` — and for the primitive itself, `a corpus population carries its unit records or nights`.
