# Osprey — ruledflt: an entries walk gives no night-rule answer

**Unit.** `snapshotEntries` in `tools/corpus-scope.mjs` wrote `ruleIsDefault: true` in both return
arms. That field answers one question, whether the caller's night regex equals `NIGHT_RE`, and an
entries walk runs no such regex. So a value stood in for not-applicable at the verdict layer.

**Branch and worktree.** `claude/ruledflt-osp` in `wt-ruledflt-osp`, base `2ce737196`. PR **#3973**,
DRAFT.

**Stopping point.** Three commits: the remedy with its changeset, the row, this handoff. The row
`2026-10-26-the-entries-walk-asserts-a-night-rule-answer-it-never-computed` rides inside the PR.
`residue-ids` reads 1 row added.

**Next step.** Ask Kestrel for the undraft on board thread 8 once the full gate reports.

**Open questions.**

- Roughly 27 sites outside `corpus-scope` write a `ruleIsDefault` literal into their own verdict
  blocks. Three of those carry null night lists, and two of the three are night refusal blocks whose
  answer binds. Whether the remaining literals each compare a real regex is unmeasured.
- `cvhr-edge-widen.mjs:375` asserts `true` by hand rather than comparing its regex to `NIGHT_RE`.
  That is a weaker instance of the same shape and nobody has logged it.

**Blockers.** None. The ledger conflicts on every parallel PR, so a rebase before the merge re-runs
`residue-ids` rather than keeping one side.

**The lesson worth carrying.** My first leg against the hand-written mirror read as COVERED. It
compared the sample's VERDICT against a rebuilt one, and `populationVerdict` recomputes the digest
from the members while never publishing `ruleIsDefault` at any status. The anti-fix restored the whole
mirror and the leg stayed green. Gate the side the defect lives on, which here is the snapshot.

**Doc-search query that finds this work.** `ruleIsDefault true asserts a default rule that records
never had` — reranker best 0.654, hit 1 board #1352 clause 4.
