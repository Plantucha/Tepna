---
name: residue-row
description: Use when logging a verified defect to briefs/RESIDUE.md or closing a residue row — the row shape, the key format, the closed state vocabulary the gate accepts, and which rows travel with a fix versus riding a separate RESIDUE-only PR. Use when filing a finding you are not fixing now, and when a merged fix needs its row closed.
---

# Residue rows

Rules: `CLAUDE.md` §📌. Shape and vocabulary are gate-checked (`tools/residue-ids.mjs`, `docs-ledger`).

- Row: `| <key> | logged | source | defect | evidence | state |` — seven pipes. A literal `|` inside a
  cell breaks the table.
- Key: `YYYY-MM-DD-short-slug`, never a counter. Source is the real origin — a brief, a repo path, or
  `#NNNN` — not the nearest brief.
- Rows are **appended and closed, never edited**. A correction is a new row that names the old key.
- Closed state vocabulary is closed: `OPEN`, `fixed #NNNN` (bare), `→ \`<NAME>-BRIEF.md\``, or
  `withdrawn <key-of-the-row-stating-the-withdrawal>`. Nothing else passes.
- **A row whose whole life is this PR travels inside it** — logged and closed as
  `fixed #<that same PR>`, the number read back from `gh pr view`, never typed. Touching *other* rows
  — closing someone else's, or one this PR does not fix — rides a separate RESIDUE-only PR, one in
  flight at a time.

## Measured

Closing **other** rows in the same commit as a fix made the PR DIRTY and it got **zero workflow runs**
while other rows kept landing (#3400, 2026-10-11): `RESIDUE.md` is appended at the end, so two PRs that
both touch it conflict. That cost is what splits other closures out — it is not an argument against the
row that is *about* this PR, which adds no second conflict surface (owner ruling 2026-10-12; #3462
carried its own row and landed CLEAN).

An annotated state cell (`fixed #3401 (mechanism refuted)`) was refused by the gate: the field is
machine-readable, so the explanation goes in the evidence cell instead.

A literal `|` inside a cell broke the seven-pipe table twice in one night.

Memory: `the-tool-that-said-fixed-is-the-one-the-row-warns-about`.
