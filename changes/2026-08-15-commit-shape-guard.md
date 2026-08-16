---
bump: patch
type: added
brief: AGENT-NEUTRAL-GUARDS-2026-08-15-BRIEF.md
---

`tools/commit-shape.mjs` — the agent-neutral half of the shared-tree guards, wired into the `static`
CI job.

The existing guards are Claude Code `PreToolUse` hooks resolved through `$CLAUDE_PROJECT_DIR`, so they
enforce nothing for any other operator, and nothing at all in a checkout that has not pulled them.
Prevention cannot be made agent-neutral — it is agent-coupled or install-coupled. **Detection can**,
because it reads a property of the resulting commit and CI applies to whoever opened the PR.

Detects the 2026-08-03 corruption shape: a commit deleting a changeset is a release **only if** it
deletes nothing outside `changes/` **and** co-modifies `suite.manifest.json` + `CHANGELOG.md` +
`RELEASE-MANIFEST.json`. Validated over full history — of 32 such commits, **30 releases pass with zero
false positives**; the 2 remaining are exempt by declared provenance (`Revert`, `rescue:`), never by
shape, since a rescue snapshot is deliberately shape-identical to the accident.

Refuses (exit 2) on a shallow clone rather than reporting green, because `actions/checkout@v4` defaults
to depth 1 and a scan that sees one commit finds nothing — a detector reporting success about history
it never had is the exact failure this guard exists to catch. CI now sets `fetch-depth: 0`.

Gate: the `commit-shape` group drives the pure core, including a synthetic corruption commit the
detector is **seen to fire on** — a guard never observed failing is not evidence.
