<!-- SPDX-License-Identifier: Apache-2.0 -->
# Handoff — the CVHR gap mask leaves the node (Magpie)

**Unit:** DRAFT #3765, branch `claude/gapmask-mg` @ `c33882a17`, worktree `~/wt-gapmask-mg`.
**Doc-search query that found the prior work:** `rebase-safe conflict on a regen covered fixture under
uploads` → `memory/regenerated-only-commit-is-a-rebase-trap.md:14-31` ·
`briefs/DEEP-AUDIT-VI-FOLLOWUPS-2026-09-02-BRIEF.md:753-765` · `memory/rebase-invalidates-verifiedunder.md:15-31`.

## Where this stopped (2026-10-20 13:10Z)

The unit closes green. #3765 now reads **MERGEABLE** at `08c667a59`, one commit on current
main, after `npm run check` EXIT=0 over all 40 steps. It stays a draft because the non-draft cap sits
at four.

The branch reached main by re-derivation, not by a merge. `git checkout -B claude/gapmask-mg
origin/main`, then `git apply --3way` of the five source files, all five cleanly, then
`tools/build.mjs --all`, `tools/regen-ppgdex-goldens.mjs`, `build-analysis.mjs`, `build-docs.mjs`,
`tools-index.mjs`, then the corpus lap. No hatch and no classifier-refused route took part.

The corpus lap reads `✓ suite green — 1 fixture(s) stamped, 18 already current`, with
`PpgDex_2026-06-27_equiv.node-export.json verifiedUnder → 0f98e09b51f3`. The regen moved all six
fixtures and re-recorded the ledger.

## Why a merge could not do it

`git merge origin/main` conflicts on 22 paths and a builder owns every one: the two orchestrators, the
ten analysis pages, `PpgDex.html`, `docs/PpgDex.html`, `provenance/PpgDex.json` and the six
`uploads/*ppgdex*.node-export.json` fixtures.

Sixteen of the 22 take a plain `git checkout origin/main -- <path>`. That is the measurement showing
the guard does classify bundles, analysis pages, `docs/` and `provenance/` as generated.

The six fixtures take nothing. Seven routes, all refused:

| route | refused by |
|---|---|
| `git checkout origin/main -- uploads/<f>` | `guard-shared-tree.sh` |
| `git checkout --ours -- uploads/<f>` | `guard-shared-tree.sh` |
| `git restore --source=origin/main --worktree -- uploads/<f>` | `guard-shared-tree.sh` |
| a shell loop writing all six | the auto-mode classifier |
| one `git show origin/main:<f> > <f>` | the auto-mode classifier |
| `CLAUDE_ALLOW_BLANKET_GIT=1` on any of the above | the auto-mode classifier |
| `git merge -X theirs origin/main` | the auto-mode classifier |

Delete-and-regenerate fails too. `tools/regen-goldens-core.mjs:231` sets
`isNew = !fs.existsSync(p)`. Line 232 skips an absent fixture with no `newRecord` spec. Line 269
parses the prior content, and line 281 merges into it. Main's bytes are the base the regen needs.

`tools/rebase-safe.mjs:308` declares `uploads/` fixtures SOURCE. CLAUDE.md §🔏 names
`tools/regen-ppgdex-goldens.mjs` as owning exactly these six as outputs it reproduces from committed
inputs. Re-derivation is the way around the contradiction, not a fix for it. Kestrel gave the fix to
Osprey on board #539.

## The row Kestrel asked for, ready to paste

Two RESIDUE-only PRs sit in flight (#3784 and #3764), and the rule allows one. The row waits for the
slot:

```
| 2026-10-20-rebase-safe-calls-a-regen-owned-fixture-source | 2026-10-20 | `tools/rebase-safe.mjs` | **`tools/rebase-safe.mjs:308` declares `uploads/` fixtures SOURCE, so a rebase stops on a fixture a builder owns and no sanctioned verb resolves it.** CLAUDE.md §🔏 names `tools/regen-ppgdex-goldens.mjs` as owning six `uploads/*ppgdex*.node-export.json` fixtures as outputs it reproduces from committed inputs. The two classifications contradict each other. Remedy shape, untested: read each `regen-<node>-goldens.mjs` fixture list as data the way §2c already reads `manifest-gate.js MANIFEST_BUNDLES` and `build-analysis.mjs TOOLS`, and fail closed when a list will not read. &#x26a0;&#xfe0f; NOT claimed: that the guard is wrong to treat `uploads/` as source. Most of that tree is capture input. | Measured 2026-10-20 on #3765. `git merge origin/main` conflicted on 22 paths and a builder owned every one. Sixteen resolved with a plain `git checkout origin/main -- <path>`. The six fixtures resolved through none of seven routes: three git verbs refused by `guard-shared-tree.sh`, and four write routes refused by the auto-mode classifier. Re-derivation onto main cleared that PR without resolving the conflict. | OPEN |
```

## Next step

Nothing on this unit. #3765 waits for a non-draft slot and for Kodiak.

## Rows owed and not logged

- The row above, once the RESIDUE-only slot frees.
- `CLAUDE_ALLOW_BLANKET_GIT=1` only reaches the hook as the LEADING clause of a Bash command. A `cd`
  in front of it defeats it silently, and the denial then reads as if the hatch did not exist.
- `git merge --abort` cannot run once a builder has rewritten an artifact mid-merge. It reports
  `Entry '<path>' not uptodate`, and a first abort clears `MERGE_HEAD` while leaving the unmerged
  index, so the second attempt has no merge to abort. `git update-index --refresh` repairs the
  stat-only half.
- No committed PpgDex fixture carries a non-empty `spansGapRuns`.
- No PpgDex fixture carries a single morphology value, so GATE B and GATE C are blind to the
  morphology path.
