---
name: residue-row
description: Use when logging a verified defect to briefs/RESIDUE.md or closing a residue row — the row shape, the key format, the closed state vocabulary the gate accepts, and why a code PR carries no row and what rides a RESIDUE-only PR instead. Use when filing a finding you are not fixing now, and when a merged fix needs its row closed.
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
- **A code PR does not touch `RESIDUE.md`** (owner, 2026-11-07, reversing the 2026-10-12 ruling
  that let a PR carry its own row). A fix that ships needs no row, because its changeset records it.
  A finding that you do not fix goes in a RESIDUE-only PR. Only one is in flight across the fleet.
- **A fix for a row already on main names it on a `Residue-fixed: <key>` line in the PR body** (one
  line, keys separated by spaces or commas). After the merge, `tools/pr-walker.mjs` opens the
  RESIDUE-only draft PR that writes `fixed #<your PR>` in that row's state cell. It edits a row only
  if the row reads exactly `OPEN` on main, and it keeps one closure PR in flight. A key that you only
  mention in prose closes nothing. A typo is reported once on the landing page and closes nothing.

## Measured

Closing **other** rows in the same commit as a fix made the PR DIRTY and it got **zero workflow runs**
while other rows kept landing (#3400, 2026-10-11): every PR appends to the end of `RESIDUE.md`, so two PRs that
both touch it conflict. The 2026-10-12 ruling let a PR carry the row that was about itself. The owner reversed it on
2026-11-07: in one day 28 of 68 merges touched `RESIDUE.md`, every one of them put each open PR with a
row into conflict, and the walker rebased #4458 21 times and #4503 7 times.

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
