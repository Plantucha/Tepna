<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [suite]
brief: CAPTURE-HOST-SUBPROCESS-SURFACE-FOLLOWUPS-2026-08-04-BRIEF.md
---
`guard-ruff.sh` — the Python half of `guard-format.sh`, closing §5.

**The mechanism question was already settled and the coverage was half.** §5 proposed a git
`pre-commit` hook running `ruff`. That was **declined** with a reason `guard-format.sh` records:
a git hook must be installed, `core.hooksPath` is unset here, several sessions share the tree — so
the common state is *"a hook that exists in-repo and runs for nobody"*. A PreToolUse guard was built
instead. But it covers `*.js/*.mjs` via Biome, while §5's actual defect is Python:

> *"`pytest --cov` printing 100 % and `ruff` failing on the next line happened in #852 and again in
> #880, same defect (an unused import), same position. The brief already said to read both. A note is
> weaker than a check."*

**Tested against a real workflow before writing it**, as §5 demands — the last hook proposed there
would have blocked every release, and that was only found by testing. Measured: `ruff check .` over
capture-host's 43 files exits **0 in 9 ms**, so on a clean tree this blocks nothing and costs nothing.

**Staged paths only, and only under `capture-host/`.** A whole-tree lint would block a docs-only or
JS-only commit over a Python file its author never touched — the exact "would have blocked every
release" failure. Two assertions pin that scope.

**Fails open when ruff is absent**, exactly as the Biome guard does: ruff lives in
`capture-host/.venv`, which is gitignored, so a fresh worktree — the checkout CLAUDE.md §👥.1 tells
every session to make — has none. A guard that blocked every commit there gets switched off.

18 assertions in `guard-ruff.test.sh`, wired into `npm run test:hooks`. It **SKIPS loudly rather than
passing** when ruff is unavailable, because a green run that never invoked ruff certifies nothing.

⚠️ One assertion was wrong first: I expected `echo git commit` to ALLOW. The shared matcher fires on
`git commit` anywhere in the line, so it denies — an over-trigger on a harmless string, and the safe
direction. It is byte-identical to `guard-format.sh`'s matcher deliberately: two guards disagreeing
about what counts as a commit is worse than one that occasionally denies an echo. Pinned so a future
"improvement" has to change it on purpose.
