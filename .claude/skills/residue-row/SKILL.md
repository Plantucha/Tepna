---
name: residue-row
description: Use when logging a verified defect to briefs/RESIDUE.md or closing a residue row — the row shape, the key format, the closed state vocabulary the gate accepts, and why a fix PR must not touch the ledger. Use when filing a finding you are not fixing now, and when a merged fix needs its row closed.
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
- **A fix PR must not touch `RESIDUE.md`.** Closures ride a separate RESIDUE-only PR, one in flight at
  a time, with numbers read back from `gh pr view`.

## Measured

Closing a row in the same commit as the fix made the PR DIRTY and it got **zero workflow runs** while
other rows kept landing (#3400, 2026-10-11) — which is why closures were split out.

An annotated state cell (`fixed #3401 (mechanism refuted)`) was refused by the gate: the field is
machine-readable, so the explanation goes in the evidence cell instead.

A literal `|` inside a cell broke the seven-pipe table twice in one night.

Memory: `the-tool-that-said-fixed-is-the-one-the-row-warns-about`.
