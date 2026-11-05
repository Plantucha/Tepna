<!--
  WRITE-ROOT-ADOPTION-2026-11-03-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
  Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
  project root, or http://www.apache.org/licenses/LICENSE-2.0
-->
**Status:** PROPOSED (resolver BUILT with TWO arms, the per-tool readings BEGUN — verified 2026-11-05 (Heron). `tools/write-root.mjs` ships `writeRoot` and `judgeRoot` over one pure decision, and its `--selftest` passes whole. Three tools adopt it: `tools/new-changeset.mjs` writes through it, and `tools/secret-scan.mjs` (#4384) and `tools/run-check.mjs` judge through it. The §1 writer population re-measures identically today, by the two `grep` recipes §1 states. §6 adds the JUDGE population, whose figures and recipe live in §6.2. This PR ticks §6.5's third box, and no gate names either adopted set, so every other §4 and §6.5 item stays open) · **Created:** 2026-11-03

# Every writing tool resolves the checkout it writes from the run, not from its own path

**What this is.** One resolver now exists and two tools use it. This brief owns the rest of the
population, because the row that produced it names a reach of tools rather than a single defect.

The resolver has since grown a second arm, so this brief owns two populations. §1 to §5 hold the tools
that WRITE a tree. §6 holds the tools that JUDGE one — the same decision, a different verb, and a
different reading for each tool.

## 1 · The measurement

The inbound row is `2026-11-02-a-tool-run-by-absolute-path-writes-into-its-own-checkout`, whose source is
`tools/new-changeset.mjs`. It closes to this brief, because it names a reach of tools and this
brief owns that reach.

`tools/new-changeset.mjs` resolved its `ROOT` from `import.meta.url`, joined it to `changes/` and wrote
there. Called by its absolute path from a worktree, the shared root's copy wrote the changeset into the
shared root. Exit 0, no warning. The tell was `git status --short changes/` printing nothing in the
worktree that had just asked for the file.

Measured 2026-11-03 over `tools/*.mjs`:

| figure | value | how to reproduce |
|---|---|---|
| tools resolving a root from `import.meta.url` | 139 | `grep -lc 'const \(ROOT\|REPO_ROOT\|repoRoot\) = .*import.meta.url' tools/*.mjs` |
| of those, tools that write | 56 | the same list, filtered by `writeFileSync` or `appendFileSync` |
| converted so far | 1 | `tools/new-changeset.mjs` |

## 2 · The route

`tools/write-root.mjs` holds it. `writeRootOrDie(import.meta.url)` returns the git toplevel of the
directory the run started in, and refuses when that disagrees with the tool's own checkout. The
refusal names both trees and the command that would have been right, and it exits 2.

Three rules the resolver already follows, so an adopting tool inherits them:

- **It refuses, it never guesses.** Two checkouts that disagree are two work-units.
- **Reading keeps its reach.** A tool that reads a peer checkout is doing something legitimate, so each
  tool keeps its own `import.meta.url` root for reads and defaults.
- **Call it where the write happens.** A module-scope call would refuse on import, which would break a
  test in another checkout that imports the tool as a library.

## 3 · The open question this brief exists to answer

A tool is not wrong to write its own checkout. `build.mjs` writing the bundles beside its own source is
the same call as `new-changeset.mjs` writing `changes/`, and only the INVOCATION separates them. So each
of the remaining 55 writers needs one reading, not a blanket conversion:

- Does the tool write a tracked work-unit artifact, which a wrong checkout loses? Convert it.
- Does it write a scratch or analysis path outside the repo? Leave it, and say so in its header.
- Does it write a generated tree that a gate re-checks in CI? Convert it, because a stale generated
  tree in the wrong checkout reds a job nobody can read from the worktree that caused it.

## 4 · Acceptance

- [ ] Each of the 56 writers carries one of the three readings above, recorded in its own header.
- [ ] Every writer of a tracked work-unit artifact calls `writeRootOrDie`.
- [ ] A gate names the adopted set, so a new writing tool joins it deliberately rather than by habit.
- [ ] The population figures here are re-measured at closing, because `tools/` grows every week.

## 5 · What is already done

- `tools/write-root.mjs`, with 38 selftests over the pure decision, the two messages and the four
  wrappers.
- `tools/new-changeset.mjs` wired on the write arm, with the cross-checkout call refusing and writing
  nothing.
- `tools/secret-scan.mjs` wired on the judge arm (#4384), with the cross-checkout run exiting 2 and
  publishing one `NOT_RUN` verdict that carries `result: null`.

## 6 · The second arm: a gate that judges a tree nobody asked it about

The inbound row is `2026-11-04-a-verdict-gate-judges-the-checkout-it-lives-in-not-the-one-it-ran-from`,
whose source is `tools/secret-scan.mjs`. It closes to this brief, because it names a reach of tools and
this brief owns that reach. #4384 fixed the one measured instance and built the arm.

§2's second rule says reading keeps its reach, and that rule stands. **Reading in order to DECIDE is a
third category.** `tools/secret-scan.mjs` ran every `git` call with `cwd: ROOT`, and `ROOT` came from
`import.meta.url`. A run from a worktree by the shared root's absolute path answered
`NOT_RUN — HEAD adds no commits over origin/main`. The status was honest. The reason stated something
true about a tree the reader never named, under a question the reader asked about another tree.

Reading a peer checkout stays legitimate. Publishing a `tepna.verdict/1` about one does not.

### 6.1 · The route

`judgeRoot(import.meta.url)` and `judgeRootOrDie(import.meta.url)` sit beside the two write wrappers,
over the same pure `writeRootDecision`. The refusal says JUDGE, because a message saying WRITE describes
something a gate never does. §2's three rules carry over, and the third one bites harder here: a gate
resolves its tree inside `main`, so a library import and a `--verdict-sample` still examine no tree and
still cannot refuse.

A refusing gate owes a verdict. `secret-scan.mjs` routes its refusal through its own `refuse`, so the
run exits 2 with one object carrying `status: NOT_RUN` and `result: null`.

### 6.2 · The measurement

Measured 2026-11-05 over `tools/*.mjs` at `feecbee8b`:

| figure | value |
|---|---|
| tools in `tools/*.mjs` | 323 |
| of those, tools that touch a verdict | 131 |
| of those, tools deriving a root from `import.meta.url` | 116 |
| of those, tools passing that root as a child's `cwd` | 50 |
| converted so far | 2 — `tools/secret-scan.mjs` · `tools/run-check.mjs` |

Three greps reproduce the last figure. The pipes live in a code block, because a pipe inside a table
cell ends the cell:

```sh
grep -lE 'tepna\.verdict/1|verdict\.js|Verdict\.' tools/*.mjs \
  | xargs grep -l 'fileURLToPath(import.meta.url)' \
  | xargs grep -lE 'cwd: *(ROOT|REPO|REPO_ROOT|repoRoot|SELF_ROOT)' \
  | wc -l
```

### 6.3 · Two caveats the figures carry

**The recipe counts the SHAPE, never the exposure.** `tools/secret-scan.mjs` adopts the arm and still
matches all three greps, because `main` reassigns `ROOT` through `judgeRoot` and the git calls still read
`cwd: ROOT`. So subtract an adopter by name. A regex cannot see the conversion.

**#4384 published 49, because that measurement added a fourth condition: the literal word `git`.** The
narrower condition hid `tools/run-check.mjs`, which passes `cwd: ROOT` to `npm run <step>`. That tool
runs the whole 50-step gate, so the condition hid the most consequential site in the population. Both
figures are honest about their own recipe, and the wider one is the one this brief carries.

A vocabulary search decides nothing about behaviour. Heron measured that twice in two days: the sidecar
census in #4374 searched each test for an absent-or-unreadable cue and over-counted by three, because
three tests held the path in this repo's own words. So each of the 49 remaining sites owes one reading.

### 6.4 · The three readings for a judge site

§3 asks three questions of a writer. A judge site takes three of its own:

- Does the gate judge an artifact of the RUN's work-unit — a diff, a commit range, a staged set, a
  branch? Convert it.
- Does it judge a tree it OWNS by design — a generated tree beside its own source, or its own
  selftests? Leave it, and say so in its header.
- Does it compare two checkouts deliberately? Leave it. Reading keeps its reach.

### 6.5 · Acceptance

- [ ] Each of the 48 remaining judge sites carries one of the three readings above, in its own header.
- [ ] Every gate judging an artifact of the run's work-unit calls `judgeRootOrDie`.
- [x] `tools/run-check.mjs` carries its reading, because it runs the whole gate in the tree it resolves.
      Done 2026-11-05: it resolves through `judgeRoot` inside the CLI block and refuses a disagreement with exit 2.
- [ ] A gate names the adopted judge set, so a new gate joins it deliberately rather than by habit.
- [ ] The population figures here are re-measured at closing, because `tools/` grows every week.
