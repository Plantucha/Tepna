# Magpie — unit `probesplit`

**Row:** `2026-10-26-wiring-a-population-verdict-costs-the-probe-safety-that-made-it-cheap` (OPEN at the ref; I logged it at board #1600)
**Branch:** `claude/probesplit-mg` · **Worktree:** `wt-probesplit-mg` (sibling of the primary checkout) · **Base:** `c39ab4a64`
**Rule 0:** `corpus-scope exec closure splits the probe-safe population` → `briefs/RESIDUE.md:951`, `tools/argv-survey.mjs:closureHazards`, `handoffs/magpie-enumwire.md`.
**Order:** Kestrel, board #1642, after I reported the premise correction at #1641.

## The premise the row got wrong, and what Kestrel ruled

The row prescribes a split of the pure verdict half from the git and write half. That split does not
exist as written. The verdict half CALLS the git half: `populationVerdict` and `censusVerdict` both
route through `producedByOf`, which falls back to the commit reader when a caller names no commit.
That fallback is load-bearing, and the comment above `producedByOf` records why. So the cut only
works if the commit read is itself pure.

Kestrel ruled at #1642 to build a pure commit reader under four conditions. Publish the full
40-character sha. Keep `execFileSync` git as the oracle, with selftest agreement in a plain checkout
and in a worktree. Refuse an unknown ref store by name. Update the suite leg that pins `gitCommitOf`
in the same diff.

## What changed

`tools/corpus-scope-core.mjs` is new and holds the population half: the root parser, both
snapshotters, `populationVerdict`, `censusVerdict`, `ruleLine`, the removal namers and
`producedByOf`. It imports `node:crypto`, the reading half of `node:fs`, `node:module`, `node:path`
and `node:url`, and nothing else.

`tools/corpus-scope.mjs` keeps `countUnder`, which runs `find`, plus the CLI and the 98-assertion
selftest. It re-exports every core name, so no caller of the old module broke on the day of the
split. The old `git rev-parse` reader stays there as `gitCommitOfExec`, the oracle.

Fifty tools under `tools/` and one under `tests/` now import the core directly.

## The measured outcome

`inertPopulation` from `tools/argv-survey.mjs`, which is the probe-safe set, over `tools/`:

| | tools |
|---|---|
| base `c39ab4a64` | 41 |
| this branch | 67 |
| gained | 26 |
| lost | 0 |

Over the wider `closureHazards`-empty set the same measurement reads 58 → 85. Both arms ran the
gate's own predicate, never a word list of mine.

## The pure reader, and why it is checked against git

`gitCommitOf` reads `.git` with `readFileSync`. It handles `.git` as a directory and as a worktree
file naming a gitdir, follows a symref chain to a depth of 8, and looks in loose refs and in
`packed-refs` in both the worktree gitdir and the common dir. Anything else returns `null` with a
named reason, and the reader names a `reftable` store as itself.

A hand parse of a format somebody else owns is only worth trusting while something keeps checking
it. Five selftest legs compare it to `gitCommitOfExec` over a real repository that the selftest
builds with git: a plain checkout, a worktree, and both again after `pack-refs --all`. The oracle
answers `--short`, so the comparison is a prefix test and never equality.

## The two consumer rules that key on a module name

🔴 **A RULE KEYED ON THE MODULE NAME DECLARES EVERY REPOINTED TOOL UN-DELEGATED.**
`corpus-reads.mjs importsNightPrimitive` and the suite's `moduleImporters` filter both read
`'./corpus-scope.mjs'` as a literal. After the repoint they matched zero tools. The anti-vacuity leg
caught it, which is what it is for. Both now read `corpus-scope(-core)?.mjs`.

🔴 **AND THE OLD `reports` CLASSIFICATION WAS AN ARTIFACT OF THE DEFINITION SITTING IN THE FILE.**
`classifyTool` cleared `corpus-scope.mjs` because `/\bpopulationVerdict\s*\(/` matched its own
`export function` line. Move the definition out and the CLI reads as an enumerator that reports
nothing, even though it prints a `censusVerdict` object on every run. The rule now accepts either
builder. Measured over 293 tools, that second name moves exactly one row, and three new
discrimination cases pin it.

## Gates

- `node tools/corpus-scope.mjs --selftest` — 98 ok, 0 fail
- `node tools/corpus-reads.mjs --selftest` — 39 ok
- `node tools/night-rule-horizon.mjs --selftest` — 25 ok
- `node tools/verdict-adoption.mjs --check` — green, 141 `decides`, 0 de-adopted
- `npx --no-install biome check tools/ tests/` — 0 errors
- `npm run check` — appended below

## Not in this PR

Nothing. The residue row closes here, with the corrected premise in its closing cell, per #1642.

---

## FINISHED 2026-10-27 05:55Z — head `2bdeac808`, PR #4002 DRAFT, all 41 steps pass

`npm run check` EXIT=0, `✓ check — all 41 steps passed`, suite 14,476 assertions over 830 groups. `pr-compliance` 9 of 9 PASS before `gh pr create`. I removed the throwaway base worktree.

⚠️ **I LINTED THE HANDOFF AND THE PR BODY, AND NOT THE CHANGESET.** Step 37 red on `two-imperatives` plus `long-sentence` in `changes/2026-10-27-probe-safe-population-half.md`. ste-lint reads EVERY new Markdown file in the diff, changesets included. Lint the whole new-file set before the gate, not the prose a reader will see.

## LANDED-READY 2026-10-27 06:35Z — head `b22e31ef8`, PR #4002 DRAFT, all 41 steps pass

The branch carries three commits plus two merges: the split, the row close, and Kodiak base merges. `npm run check` EXIT=0 on the final pushed state, suite 14,476 assertions over 830 groups.

🔴 **`check8b` ADMITS ONLY THE VOCABULARY IN A RESIDUE STATE CELL, SO THE CLOSING TEXT CANNOT CARRY A PREMISE.** My first close wrote the corrected premise into the state cell. The gate named the row. The cell takes `→ `brief``, `fixed #N`, `withdrawn <key>` or `answered <ref>`, and nothing else. The premise lives in the PR body and here, and `fixed #4002` resolves to both. Heron hit the same anchored-cell shape on a source cell.

⚠️ **KODIAK MERGED `main` INTO MY BRANCH WHILE I HELD AN UNPUSHED COMMIT**, so the push read non-fast-forward. That is the benign §2d case: `kodiakhq[bot]` at the head with my commit contained. I merged it in and pushed, then re-ran the gate on the final state. A gate run before someone else's merge never examined the tree that lands.

## REWRITTEN 2026-10-27 06:10Z — one commit `a089061c5`, after `secret-scan` red

🔴 **A COMMENT I ONLY MOVED CARRIES ITS HOME PATH INTO A NEW FILE, AND THE SCAN READS THE ADDED LINE.** `secret-scan` fired `home-path` at `corpus-scope-core.mjs:65`. The text has sat in `corpus-scope.mjs` on `main` for weeks, so a split re-adds it as new content. The gate is right: the rule reads what a commit ADDS. The comment now names the tree without spelling the path.

**A fix commit does not clear it, because the finding stays in history.** I collapsed the branch to one commit with `git reset --soft origin/main`, then pushed with `--force-with-lease`. `git log origin/main..HEAD` carries the old path on a deletion line only, which is the moved-out original.

`npm run check` EXIT=0 again on `a089061c5`, 41 of 41 steps, 14,476 assertions over 830 groups.
