# Heron · unit 56 `guardscope`

**Status:** DONE 2026-10-26 · board claim #1364, released · finding #1366 · SIZED, no PR.

## 1 · Unit

Measure which tree `guard-stale-ledger.sh` and `guard-stale-brief.sh` actually examine, after both
denied every commit of unit 55 in a worktree cut from the ref.

## 2 · Branch and worktree

None. The unit reads only, and it probes the two hooks as children with synthetic payloads. The probe
script sits at
`/tmp/claude-1000/-home-michal-Tepna/4429f848-d75b-4221-a777-45a050d60b38/scratchpad/probe-guardscope.sh`.
The row text sits beside it as `row56.md`, and the posted report as `rep56.md`.

## 3 · Exact stopping point

The measurement is complete and posted. A clause naming the ledger under `git -C <worktree>` denies
with the base at the root, 101 commits behind. The same clause after `cd <worktree>` passes. A
write-shaped append to an absolute worktree brief path denies, and the same append after a `cd` passes.
Derivation sits at `guard-stale-ledger.sh:147-155` and `guard-stale-brief.sh:126-180`, each reading `cd`
at `:153` and `:177`.

Four sibling hooks read a `-C` target: `guard-format.sh:116`, `guard-ruff.sh:89`,
`guard-trailer.sh:102` and `guard-doc-search.sh:111`. `guard-format.sh:107` states the three-signal
order the two stale guards half-implement.

## 4 · Next step

Lift the row into my next PR, under key
`2026-10-26-the-stale-guards-read-cd-but-never-a-dash-c-tree`, source `.claude/hooks/guard-stale-ledger.sh`,
state OPEN. Then the remedy: one `-C` reader per guard, plus one `-C` leg and one absolute-path leg in
each test file. Both test files already build a stale and a current worktree.

## 5 · Open questions

Does the PreToolUse payload's `.cwd` name the command's directory or the session's? Only
`guard-doc-search.sh:74` reads it, and I did not measure it. If it names the session's directory it is
no better than the present fallback.

## 6 · Blockers

#3941 holds my one PR slot, so the row and the remedy wait for it to merge. The remedy touches two
hooks the whole fleet runs, so it lands alone and never beside a ledger change.

## 7 · The doc-search query

`node tools/doc-search.mjs --read "the stale-ledger guard denies a commit in a worktree cut from origin/main"`
returned a flat field with 0.625 at the top. The decisive prior work came from a `git grep` of the
ledger at the ref: rows `2026-09-10-stale-brief-guard-reads-the-root-base` and
`2026-09-10-guard-row-generalised-a-narrow-cause`, both `fixed #2380`, plus
`memory/guard-examines-the-hooks-cwd-not-the-commands.md`, which states the three-signal order this
unit found half-implemented.
