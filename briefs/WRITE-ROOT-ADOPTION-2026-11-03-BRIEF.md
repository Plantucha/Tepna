<!--
  WRITE-ROOT-ADOPTION-2026-11-03-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
  Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
  project root, or http://www.apache.org/licenses/LICENSE-2.0
-->
**Status:** PROPOSED · **Created:** 2026-11-03

# Every writing tool resolves the checkout it writes from the run, not from its own path

**What this is.** One resolver now exists and one tool uses it. This brief owns the rest of the
population, because the row that produced it names a reach of tools rather than a single defect.

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

- `tools/write-root.mjs`, with 22 selftests over the pure decision, the message and the two wrappers.
- `tools/new-changeset.mjs` wired, with the cross-checkout call refusing and writing nothing.
