<!-- SPDX-License-Identifier: Apache-2.0 -->
# Handoff — the test runner's input rail (Magpie)

**Unit:** `briefs/FIXTURE-CORPUS-REACHABILITY-2026-08-09-BRIEF.md` + `REGEN-CORPUS-PATH-FOLLOWUPS-2026-08-03-BRIEF.md` §3.4 (its third consumer).
**Doc-search query that found the prior work:** `test runner resolves a committed input against DEX_UPLOADS and reads it as absent`
→ `tests/run-tests.mjs` [chunk 86/112] · `tools/regen-goldens-core.mjs:96-149` · `briefs/REGEN-CORPUS-PATH-FOLLOWUPS-2026-08-03-BRIEF.md:33-50`.

## Where this stopped (2026-10-19 00:25Z)

**DRAFT #3709** — `claude/twinrail-mg` @ `2f25240fc`, worktree `~/wt-twinrail-mg`, board entry #300.
`npm run check` EXIT=0, all 39 steps, 13288 assertions over 797 groups. The PR carries its own residue row
(`2026-10-19-one-rail-cannot-hold-both-halves-of-the-input-set`, closed as the #3709 closure). Kestrel's walker undrafts in queue order.

This unit owes nothing further. No bundle, DSP or fixture moved, so no re-bundle and no provenance lap.

## Carry this forward

**A resolver that picks a DIRECTORY cannot serve an input set whose halves live in different trees.**
`corpusSearch` answers "where is the corpus" with one directory, which is right for a whole-corpus
consumer and wrong for a per-file one: git ignores a recording, so it sits only in a corpus, while a
committed input is a repo artifact that sits only in a checkout. The runner now searches the rails per
file, with `UPLOADS` at the head so the change only widens.

**The gate that names its consumers needs re-reading whenever a fourth one appears.** §3.4's CONSUMERS
list held nine regen tools and `verify-fixtures.mjs`. The runner that re-runs every input was never in it,
so the single-sourcing it asserts had a hole for two months. Five assertions cover the runner now, and
four of them RED by value on `origin/main`'s copy — which is the only way to know a source-scan leg is
not hollow.

**Measure the before state in every environment the code runs in, not the one you are standing in.**
With no override the worktree skipped 13 equivalence legs; with `DEX_UPLOADS` at the corpus root it
skipped 2 and RED one group. One of those three numbers would have been the whole story.

## Next step

Back to the PpgDex punch-list (`handoffs/magpie-ppgdex-punchlist.md`) or the next open residue row.
The mask residue row from E-2 (step windows mark a median 1.34 % of kept intervals at 7–31x a matched
random null) is still unlogged and waits for a ledger slot.
