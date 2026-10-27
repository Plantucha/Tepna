# Osprey — unit `reanchor`

**Unit.** Re-anchor the drifted mutation-equivalence entries, with a probe for each entry (owner
ruling, board #1549 item 21). Discharges row
`2026-10-20-239-drifted-equivalence-entries-wait-on-a-re-anchor-decision`.

**Branch + worktree.** `claude/reanchor-osp` @ `25bcebb87` in `wt-reanchor-osp`, base `a401799ac`.
PR **#3989**, DRAFT. Two commits: the tool and ledger, then the residue rows.

**Stopping point.** Everything is built, committed, pushed and asked. `npm run check` was green on the
code commit — all 41 steps, 14,458 assertions, `EXIT=0` — and re-ran on the final state after the row
commit. `pr-compliance` passed 9 checks before `gh pr create`. The owner question sits on board
thread 8 as #1565.

**Next step.** Read the final-state gate result, then wait for the owner's answer on #1565 and for
Kestrel to undraft. I do not undraft my own.

**What the probe found.** `movable 272 · re-anchored 239 · REFUTED 33 · unprobed 0 · collided 0`. The
row's 239 was five days old; the real figure at the base was 272. The 33 refutations are the unit's
finding: those excuses name a mutant the suite kills, so a bare re-anchor would have re-armed 33 false
claims. Their addresses stayed orphaned.

**Open questions.** The owner's call on the 33, which is #1565: re-verify each at its original site,
delete them and make the mutation gate stricter on five DSP nodes, or leave them orphaned. I chose
none, because deleting changes what the gate blocks.

**Blockers.** None for this PR. The remedy for the 106 ambiguous and 29 stale entries needs a key
change (carry the enclosing function), which is its own unit and touches `mutate.mjs`'s
`loadEquivalence` plus the capture-host ledger tests.

**Doc-search query that finds this.** `re-anchor the drifted mutation equivalence entries with a probe`
→ `briefs/RESIDUE.md:714`, `tools/mutate.mjs:1340-1391` `classifySurvivors`, memory
`owner-decisions-2026-09-26.md:297-307`.

**Rows.** Closed `2026-10-20-239-drifted-…` as the #3989 closure. New and OPEN:
`2026-10-26-thirty-three-equivalence-excuses-name-a-mutant-the-suite-kills` and
`2026-10-26-a-line-keyed-equivalence-entry-that-drifts-ambiguously-cannot-be-placed`. New and closed:
`2026-10-26-a-report-only-tool-write-path-held-two-defects-nobody-could-see`.
