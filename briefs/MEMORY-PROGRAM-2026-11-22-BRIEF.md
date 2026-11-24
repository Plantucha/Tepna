<!--
  MEMORY-PROGRAM-2026-11-22-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** IN-PROGRESS — 2026-11-22 · **Created:** 2026-11-22 · **Owner:** "spend it on memory program", 2026-11-22 (API credit that ends 2026-12-01)

# Memory program — measure, consolidate and version the fleet memory

## 1 · Goal

The shared memory directory only grows. On 2026-11-22 it held 828 files and 10.3 MB, with no
version control and no merge of duplicates. The Kestrel state file alone is 265 kB, so only `tail`
can read it. This program measures how often the memory misleads a bird. It then proposes a smaller,
current and versioned memory. A bird reviews each proposal before anything moves.

## 2 · Budget and limits

- The owner gave the API credit that ends on 2026-12-01 to this program. The tool caps the spend
  with `--cap-usd` and keeps a ledger from the real `usage` of each answer.
- The tool reads the memory directory and never writes to it. Every output goes to
  `<git common dir>/tepna-mutation/memory-program/`, which git does not track.
- The tool redacts private addresses, push and ping URLs, password fields and long tokens before
  text leaves the rig. The tool skips a file that still matches after the pass.
- A deletion is an archive move, never a removal, unless the owner says otherwise.

## 3 · Steps

- [x] **A · Baseline.** A fixed set of questions with a known current answer. Score whether the
      top doc-search hit is current and correct. Record file count, kB and the hit rate.
      Done 2026-11-23. The question is a real fleet query. The answer is the memory file that the same
      session then read. Section 8 gives the score.
- [x] **B1 · Classify** each file with `tools/memory-program.mjs` (Batch API, `claude-opus-5-5`):
      kind, lane, summary, durable claims with their identifiers, historical flag, promotion hint.
      Done 2026-11-22. The table below gives the result. One file is over the 1M-token request limit
      and was not classified.
- [x] **B0 · doc-search output cuts** (section 6). Done 2026-11-22 in this PR.
- [x] **B2 · Dead references.** `refs` checks each cited identifier against `origin/main`.
      Done 2026-11-23. The memory repo gates typed citations and repairs links between notes.
- [x] **B3 · Duplicates.** Cluster the claims by bge similarity on the rig. Ask the model to merge
      each cluster into one current claim and name the claims it replaces.
      Done 2026-11-23. Of 30 archived notes, a live note names 26 in `supersedes`. The other four state
      "historical, no successor".
- [ ] **B4 · State files.** Roll each state file into a short head plus an archive.
      Done on 2026-11-23 for Kestrel, Heron, Osprey and Magpie. Wren and Finch are not switched.
- [ ] **C · Rules to skills.** Fold each promotion candidate into an existing or new skill under
      `.claude/skills/`, one PR at a time. First unit 2026-11-23: `memory-append`,
      `handoff-at-a-unit-boundary`, `worktree-to-pr` and `land-through-the-queue`.
      Second unit 2026-11-23: the new skill `kill-a-mutant` carries five mutation rules.
- [ ] **D · Re-measure** with the step A question set. Report the before and after.

## 4 · Acceptance

- The step A hit rate after the program is not lower than before it.
- Every merged or archived memory file names its replacement.
- No secret, private address or key reaches a tracked file or the API.

## 5 · Why raw HTTP and not the SDK

The repo calls every model provider through raw `fetch` (`tools/gemini-review.mjs`) and carries no
provider SDK. This tool follows that convention, so it adds no dependency.

## 6 · Measured result of B1 and the doc-search cuts

Classification, 2026-11-22, one batch over the rig memory directory:

| item | value |
|---|---|
| files sent | 807 |
| files answered | 806 |
| files refused for size | 1 (`heron-state-2026-10-19-drain.md`, 1,182,944 tokens) |
| spend, ledger | $13.21 (pilot $0.50 included) |
| kind: lesson / rule / state / reference / incident / index / other | 672 / 65 / 60 / 15 / 7 / 5 / 2 |
| files marked historical | 10 |
| files with a skill hint | 717 of 826, so the hint does not select; the 65 `rule` files do |

doc-search use, 7 days, four rig transcripts:

| item | value |
|---|---|
| searches | 6,537 |
| exact repeat of a query in the same session | 2,630 (40 %) |
| output bytes, median / p90 / max | 1.1 kB / 5.7 kB / 23.6 kB |
| bge cosine of the top hit vs. a returned path used in the next 12 calls | 0.50 → 35 %, 0.60 → 68 %, 0.70+ → 87 % |

This PR keeps Rule 0 as it is: search before any analysis. It changes what one search costs:

1. A repeat of a query in the same session within 30 min prints one line. `--again` runs it in full.
2. Each passage is cut to 400 characters (`PASSAGE_CHARS` in `tools/xerj-query.mjs`).
3. Below the reranker floor, the answer is the refusal line and one line of at most three paths.
4. The long read-warning prints on the first search of a session only.
5. Each search appends its best score to `<git common dir>/tepna-mutation/doc-search-scores.jsonl`,
   so a later unit can set the floor from this fleet's data.

Measured on one query: the default answer fell from 5,631 to 3,139 bytes, a repeat to one line, and
a refusal to 594 bytes.

## 7 · Decided design for the next units

The owner asked for a robust design from the start. An Opus review compared three designs on
2026-11-22. This program takes the hybrid:

- Memory never goes into this repo, because this repo is public. On 2026-11-22, 104 of 829 memory
  files held a home path or a private address. The owner chooses the host: a private GitHub repo,
  or a git repo that stays on the LAN.
- Each memory file is markdown in git with a type. Its frontmatter carries type, lane, date, `last-verified`,
  `supersedes` and typed citations (`path:`, `brief:`, `#PR`).
- A CI gate blocks only a typed citation that does not resolve. An untyped citation warns.
  Staleness is a weekly report, never a merge block.
- A tool builds a SQLite index from git HEAD. Any bird can delete it and build it again. doc-search indexes the
  same files.
- State files stay out of git. Each one keeps a head of at most 2 kB and an unindexed archive.
- An unmerged lesson waits in a local inbox. Each bird sends its inbox as one memory PR a day.
- A tool writes `MEMORY.md`. Rules move to skills, not to `CLAUDE.md`.
- One unit reconciles the vigil copy: 423 identical files merge, 339 one-sided files import, and
  140 files that differ get a model summary of the difference for a session to choose.

Rejected: mem0, Letta and Zep. Each needs a model on the write path, keeps state a reviewer cannot
read, and adds a second retrieval system next to bge.

## 8 · Step A score and the state after the switch

Score of 2026-11-23, before the switch, 923 queries. A hit is a printed note that the session then read.

| stratum | queries | hit in top 1 | hit in top 5 | refused |
|---|---|---|---|---|
| L (lesson notes) | 422 | 71 | 232 (0.55) | 14 |
| S (state files) | 501 | 26 | 66 (0.13) | 14 |

The criterion of step D is the L rate in the top 5, not lower than 0.55. It was set before the switch.

| item | before | after |
|---|---|---|
| live memory | 829 files, 10,132 kB, no git | 803 notes, 3,287 kB, private git repo |
| archived notes | 0 | 30: 26 with a replacement, 4 marked historical |
| loaded `MEMORY.md` | hand-written | generated, 5.2 kB |
| links between notes | 3,019 | 2,970: 2,891 live, 4 to the archive, 75 to a note nobody wrote |

The drop in kB is mostly the state files, which left the indexed set (step B4).
