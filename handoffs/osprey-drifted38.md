<!-- SPDX-License-Identifier: Apache-2.0 -->
# Osprey · unit `drifted38` — the equivalence qualifier gate reads a criterion its ledger can fail

**Unit.** Residue row `2026-10-27-thirty-eight-drifted-entries-have-no-address-a-mechanism-can-reach`
over `tools/mutate-equivalence.json`. The row asked which mechanism can address the 38 drifted entries.

**Branch and worktree.** `claude/drifted38-osp` in a worktree named `wt-drifted38-osp`, rebased onto
`6aa9cfa40`. Two commits: `e9211bec7` (tool, brief, changeset, index row) and `1dd409b70` (ledger).

**Stopping point.** `npm run check` runs detached with an `EXIT=` sentinel. The selftest reads
`✓ all 75 selftests passed`, up from 59, and `--qualify` reads `EXIT=0` with the SHORTFALL object.
`node tools/residue-ids.mjs` reads `1 row(s) added, none colliding, none mutated` after the commit.

**Next step.** Read the sentinel. On `EXIT=0`, push with `--force-with-lease`, open the draft PR with
a `Rule 0:` first line, then post the report and the undraft ask on board thread 8.

**What the unit found.**
- The retired criterion counted `ambiguousWritten`, which the tool writes as the literal 0, so the
  gate could only read PASS. It did, over 38 unreachable entries. That is the §4b family.
- The criterion is now `drifted_entries_with_no_reachable_address`. The run reads SHORTFALL over 38
  of 434 entries, and every count beside it matches the pre-change baseline exactly.
- The control that matters: 421 entries open their `why` with `In <function>`, and over the 313 that
  also carry a machine-read `fn` the prose disagrees 10 times. So the prose is not an address, and
  the rescue that looks free would mis-anchor about one entry in 32.
- A baseline check worth repeating: both the pre-change and the post-change module reported
  `commit 3791af39a513`, which proves the baseline was the tool rather than a crippled copy.

**Open questions.** The owner owes a ruling on the three groups in
`briefs/EQUIVALENCE-ORPHAN-RULING-2026-10-28-BRIEF.md` — delete the 26 whose mutation is gone, decide
the 12 that repeat one mutation inside one function, and rule on the 7 conditional entries.

**Blockers.** None for the PR. The deletion cannot land without the ruling, because an orphan still
records a judgement.

**Doc-search query that finds this.** `drifted equivalence entry qualifier reachable address orphan`.
