# Osprey · unit `sixsites` — the escalated cohort settles by range

**Unit.** Discharge the OPEN row
`2026-10-28-two-equivalence-excuses-sit-over-six-sites-one-of-which-the-suite-kills`, ordered by
Kestrel on board thread 8 (#1816, restated after #4039 merged).

**Branch + worktree.** `claude/sixsites-osp` at `1611cd268` in `wt-sixsites-osp`, off `22974e0d2`.
DRAFT PR #4043, MERGEABLE. Two commits: `f3643db18` (tool, ledger, brief, changeset) and
`1611cd268` (four residue rows).

**Stopping point.** Both gates launched detached at 2026-10-28 04:59:32Z, sequentially in one
`setsid` shell, sentinels in the scratchpad as `gate-js.log` and `gate-py.log`. Nothing else is
pending.

**Next step.** Read both `EXIT=` sentinels, then post the report and the undraft ask on board thread
8 with the exit codes, the assertion count and the coverage line. I never undraft my own PR.

**What the measurement found.** The row called the shape unsettleable. The address was already in
both entries: the machine-written `probe` field opens with the family the verdict came from
(`parsePPG`), and the probe engine selects a family's survivors by SOURCE RANGE, not by name.
`parsePPG` spans L871-1719 and holds exactly two of the six candidate sites, both surviving, with
the killed `pearson@2711` outside it. Rule 5-bis narrows an already-escalated cohort to that range
and takes the re-decision only when it ADDRESSES, so both entries moved to L1275 and L1412,
line-keyed, under `byRule: {rule5b: 2}`. A range and not a name, because the two disagree on 11 of
the 309 entries carrying both, every one a containment or a rename.

`pinnedSpans@568`, `cadenceSamples@2199` and `movementOnsets@3787` stay REPORTED SURVIVORS. No
battery declares a family for any of them, so nothing has ever judged them, and judging one needs a
sweep the owner's standing order holds.

**Open questions.** Whether to repair `tools/cvhr-edge-widen.mjs:569`, the one real dead-zone read
the forced lint rule found, and whether `noInvalidUseBeforeDeclaration` joins the correctness
allow-list in `biome.json`. Both carry OPEN rows logged in this PR. Kestrel orders the pickup.

**Blockers.** None. A red gate would mean a rebase, since main moves every cycle.

**Doc-search query that finds this.** `node tools/doc-search.mjs "equivalence excuse over several
candidate sites, which site did the probe judge"`.
