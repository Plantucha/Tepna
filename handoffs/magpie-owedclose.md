# Magpie — unit `owedclose`

**Order:** Kestrel, a RESIDUE-only PR closing
`2026-10-27-a-fixed-spawn-timeout-makes-a-gate-step-red-under-box-load` as `fixed #4044`, plus the
three closures Heron's state lists as owed: `fixed #3913`, `fixed #3915`, `answered #3908`.
**Branch:** `claude/owedclose-mg` · **Worktree:** `wt-owedclose-mg` (sibling of the primary checkout)
· **Base:** `3897b129a`
**Rule 0:** `residue-only PR closing a row against the PR that discharged it` →
`ext:memory/an-anchored-cell-refuses-the-prose-you-owe.md`,
`ext:memory/check-the-tree-before-asking-the-owner.md:57-76`,
`ext:memory/heron-state-2026-10-18-spool-and-window.md:173-191`.

## One row moves, and three were already closed

| row | ordered | state at `origin/main` | this PR |
|---|---|---|---|
| `2026-10-27-a-fixed-spawn-timeout-makes-a-gate-step-red-under-box-load` | `fixed #4044` | OPEN | closed |
| `2026-10-21-the-polar-pull-hashes-nothing-while-the-ring-pull-hashes-its-artifact` | `fixed #3913` | `fixed #3913` | untouched |
| `2026-10-21-the-ring-clock-is-claimed-synced-on-an-unacknowledged-write` | `fixed #3915` | `fixed #3915` | untouched |
| `2026-09-06-folding-brief-assumes-8gb` | `answered #3908` | `answered #3908` | untouched |

Heron's state names a fourth, an `answered <ref>` on
`2026-10-20-pletha-position-exists-at-frame-resolution-only`. That row reads `answered #3783` at the
ref, which closes it too, and it sits outside the order either way.

🔴 **The owed list was itself stale, which is the shape Heron reported at #1853 one hour earlier.**
A list of owed closures ages exactly like a claim and exactly like a residue cell: every closure on
it had landed before the list was read. The reading that settles it is the ref, never the list —
`node tools/residue-ids.mjs --open` reads `931 shared rows, 0 differ` against `origin/main`.

## The one row, verified rather than assumed

The row names three candidate remedies and calls them unmeasured: scale the cap with the producer's
population, make it configurable per entry, or report the unexamined producer rather than failing
it. #4044 shipped the second and the third, and it also did what the row's last sentence asks, which
is to name the exception in `CLAUDE.md` §4c. A row closes on the remedy it asked for, so this one
closes.

## The diff

One state cell. `| OPEN |` to `| fixed #4044 |` on the row's line, and nothing else on that row
moves: an annotated state cell reds `docs-ledger` check 8b, and any non-state edit reds
`tools/residue-ids.mjs`. No code moved, so the PR carries no changeset.

## Gates

- `node tools/residue-ids.mjs --open` ✓ — `earlyClosed: 1` is this PR's own diff, and `differs`
  counts that same row
- `npm run check` — result appended below and posted as a PR comment
