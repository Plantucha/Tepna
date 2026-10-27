# Magpie — cut-tree recovery for published numbers

**Unit:** residue `2026-10-21-a-published-record-names-a-commit-the-squash-merge-does-not-keep`
**Branch:** `claude/cuttree-mg` · **Worktree:** `wt-cuttree-mg` (beside the primary checkout)
**PR:** #3859, DRAFT, head `d7db9dd9b`, 0 behind `50c222b00`
**Doc-search (Rule 0):** `published number record producerCommit squash merge cut tree identity`
→ `briefs/RESIDUE.md`, `tools/fold-generation.mjs` (#3854), `PUBLISHED-NUMBER-DECAY-SWEEP-2026-09-03-BRIEF.md`

## Stopping point

Every file in this unit sits in a commit on the remote branch.
Three commits: `9d45ed22e` (recovery + tests + records), `913c59c11` (new row + changeset),
`d7db9dd9b` (closes the squash-merge row with `fixed #3859`).

The full `npm run check` reads `EXIT=0` with `✓ check — all 40 steps passed` on `d7db9dd9b`, and
the failure-mark grep reads 0. GitHub reads `mergeable=MERGEABLE` with the head at `d7db9dd9b`.
Other evidence: suite 14,079 assertions over 819 groups, tool selftest 69 passed, `biome check`
clean over the three touched files, `typecheck` exit 0. **Nothing is left to do but the owner's
undraft.** I never undraft my own PR, and the slot call belongs to Kestrel.

⚠️ I pushed before the third commit existed, so the remote sat at `913c59c11` while the gate ran on
`d7db9dd9b`. Read `git for-each-ref` for the local and the remote ref before calling a head gated,
because `gh pr view` alone agreed with the stale ref.

## What landed

`tools/fold-generation.mjs` gained `--recover` and `--recover --write`, plus the exports
`cutCandidates`, `recoverCut`, `recoveredBlock`, `recoverRecords`, `recoverVerdict` and
`recordIndent`. `compareRecord` gained a data-only branch for a record whose block carries a data
digest and no comparable generation. All five `tch-pooled-hat-*` records now carry a `corpus` block.

## The findings

1. **A `producerCommit` can name a tree it never held.** The 2026-09-29 record names `f131fe57`
   (609 tracked files under the root) while documenting 658 files and digest `a8f64980ac85`. That
   digest reproduces at `593613853`. New row `2026-10-21-a-producer-commit-can-name-a-tree-it-never-held`.
2. **The recovery must prove itself.** A named commit is a hypothesis. The tool accepts a tree only when its
   all-files digest equals the digest the record already published, so a wrong name cannot mislead.
3. **∅ The generation half is null.** A legacy record states a night COUNT and no names, so no
   generation describes the population it read. A whole-root generation would read MOVED the moment
   any unread night gains a stamp. `foldGenerationAtCut` keeps the fact under its own name.
4. **A fixed indent width buries an additive change.** Three of the five records indent with ONE
   space, so a two-space rewrite reformatted 174 lines to add 29. A suite leg now holds every record
   rewrite byte-identical, with a control proving the layouts are not all one width.

## Open questions

- Should the producer stop writing `producerCommit` at all, now that a tree digest proves itself?
  The field is still useful as a pointer, and finding 1 shows it is not evidence.
- The four superseded records now carry a block nothing compares. That is deliberate: a superseded
  record is history, and the block says which tree that history rests on.
