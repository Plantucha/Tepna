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
- The state vocabulary is a closed set of five: `OPEN`, `fixed #NNNN` (bare), `→ \`<NAME>-BRIEF.md\``,
  `withdrawn <key-of-the-row-stating-the-withdrawal>`, or `answered <ref>`. Nothing else passes.
- **`answered <ref>`** (owner ruling 2026-10-12) closes a row that asked for a MEASUREMENT and got it,
  where no repair remains and the defect was real — so neither `fixed` nor `withdrawn` can state it
  honestly. `<ref>` points at the answer: the `#NNNN` that recorded the measurement, a ledger key, or a
  backticked brief. A bare `answered` reds check8b; a `<ref>` that resolves to nothing reds check8j. It
  needs no corroborating row, because an answer does not claim the defect never existed.
- **A row whose whole life is this PR travels inside it** — logged and closed as
  `fixed #<that same PR>`, the number read back from `gh pr view`, never typed. Touching *other* rows
  — closing someone else's, or one this PR does not fix — rides a separate RESIDUE-only PR, one in
  flight at a time.

## Measured

Closing **other** rows in the same commit as a fix made the PR DIRTY and it got **zero workflow runs**
while other rows kept landing (#3400, 2026-10-11): every PR appends to the end of `RESIDUE.md`, so two PRs that
both touch it conflict. That cost is what splits other closures out — it is not an argument against the
row that is *about* this PR, which adds no second conflict surface (owner ruling 2026-10-12; #3462
carried its own row and landed CLEAN).

An annotated state cell (`fixed #3401 (mechanism refuted)`) failed the gate: the field is
machine-readable, so the explanation goes in the evidence cell **of a row you are writing for the first
time**. On an EXISTING row nothing but the state cell may move — and the two halves are caught by
DIFFERENT gates, measured 2026-10-12 against main's row `2026-10-12-wt-done-tests-the-date-not-the-content`:

| the edit | what reds it |
|---|---|
| state cell annotated | `docs-ledger` check8b (`tests/dex-tests.js`): `state "fixed #3401 (mechanism refuted)" not OPEN \| → \`brief\` \| fixed #N \| withdrawn <key> \| answered <ref>`. `tools/residue-ids.mjs` **passes** it — `ok — 0 row(s) added, none colliding, none mutated`, exit 0 |
| any non-state cell edited | `tools/residue-ids.mjs` exit 1: `a non-state cell was edited (rows are append-and-close)` |

So a closure's evidence belongs in the PR body, or in a NEW row that names the old key — never appended
to the row that the PR closes, and never as a parenthetical on the state. Four rows hit this when the clause
above was read as licence to annotate a closure (Heron, #3466, reported 2026-10-12; that PR's only pushed
head runs all-green, so the refusal was pre-push; this file credits it as reported and did not re-measure it).

A literal `|` inside a cell broke the seven-pipe table twice in one night.

## Keep the closing keyword away from the number in prose

A row's state cell reads `fixed #3505`, and that is also GitHub's closing-reference syntax. Write the
prose around it: `the cell reads the #3505 closure`, never `fixed #3505` on a prose line. The table
cell itself keeps the bare form the gate demands, and a body closing its OWN number is exempt.

The mechanism is the squash, not the link. `.kodiak.toml` sets `body = "pull_request_body"`, so the
body becomes the commit message on main, and GitHub acts on a closing keyword there. Backticks do
not protect the phrase, because the squash message is plain text.

Measured 2026-10-12: #3480's body said `fixed #3476` inside backticks. #3480 merged at 16:18:16Z and
#3476 records `closed by kodiakhq[bot]` at 16:18:22Z against the squash commit 0fca5c6e, six seconds
later. The owner reopened it by hand at 17:11:49Z. `tools/pr-compliance.mjs` check 6 now reds that
phrase before it merges, and an unresolvable number reds too.

One measurement that misleads, so do not repeat it: `closingIssuesReferences` reads `[]` on #3509,
#3485 and #3466, which quote closures in their bodies. That field reports the PR-body LINK, which
GitHub draws for issues only. It says nothing about the squash commit, which is where the closure
happened.
