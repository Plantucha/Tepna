<!--
  MEMORY-PROGRAM-2026-11-22-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-11-24 · **Created:** 2026-11-22 · **Owner:** "spend it on memory program", 2026-11-22 (API credit that ends 2026-12-01)

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
- [x] **B4 · State files.** Roll each state file into a short head plus an archive.
      Done on 2026-11-23 for Kestrel, Heron, Osprey and Magpie, and by 2026-11-24 for Wren and Finch.
      Memory PR 18 adds `live.mjs remote`, the switch for a host without the memory repo (board #8239).
- [x] **C · Rules to skills.** Fold each promotion candidate into an existing or new skill under
      `.claude/skills/`, one PR at a time. First unit 2026-11-23: `memory-append`,
      `handoff-at-a-unit-boundary`, `worktree-to-pr` and `land-through-the-queue`.
      Second unit 2026-11-23: the new skill `kill-a-mutant` carries five mutation rules.
      Closed 2026-11-23. The 43 loaded rules are not procedures. Memory PR 19 retypes 11 notes that were
      not rules: 10 decisions and one reference.
- [x] **D · Re-measure** with the step A question set. Report the before and after.
      Done 2026-11-23. The criterion FAILS: L hit@5 is 0.45 and the floor is 0.55. Section 10 gives the cause
      and the search change.
- [x] **E · Currency.** A model reads each note beside excerpts of `origin/main`. A note that states an
      outdated fact gets a dated correction line. A note whose claims all hold gets a `last-verified` date.
      Done 2026-11-23, memory PR 17. Section 9 gives the result.

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

## 9 · Step E result: 185 notes corrected, 58 notes verified

The tool is `tools/currency.mjs` in the private memory repo. It ran on 2026-11-23 over 807 notes.

| item | value |
|---|---|
| notes sent | 750 (47 name no identifier, 3 match no excerpt, 7 are incident notes, left out by type) |
| notes answered | 750 |
| claims: current / cannot tell / outdated | 1,962 / 1,777 / 278 |
| outdated marks after the quote check and the absence rule | 261, in 189 notes |
| marks rejected by hand | 4 |
| notes corrected | 185 (257 marks) |
| notes stamped `last-verified` | 58 |
| spend of the batch | $30.60 (pilot $1.31) |

The criterion was set before the read: at least 0.85 of a random sample of 40 marks is right. The sample
(seed 20261123) scored 37 of 40, 0.925. The same session also read all 36 marks on rules and owner notes.

The tool drops a mark without a verbatim quote from an excerpt. It also drops a mark that rests on an
absent identifier, because at least 10 of 17 such marks were wrong.

**One breach of section 4.** The redaction missed the tailnet range (RFC 6598). The pilot and batch B1 sent
a few such addresses to the API. `tools/memory-program.mjs` and the memory repo now redact that range. The
full batch had no sensitive row. Kestrel told the owner on 2026-11-23.

## 10 · Step D result: the criterion fails, the search now prints more notes

`tools/baseline.mjs score` in the memory repo ran the same 422 L queries and 501 S queries three times on
2026-11-23. "Printed" counts every note that doc-search printed. The before and after runs printed five.

| run | L hit@1 | L hit@5 | L printed | L refused | median output |
|---|---|---|---|---|---|
| before the switch | 71 | 232 (0.55) | 232 (0.55) | 14 | 2,944 B |
| after the switch | 49 | 190 (0.45) | 190 (0.45) | 4 | 2,959 B |
| after, with the search change | 56 | 192 (0.455) | 292 (0.69) | 4 | 3,897 B |

**Verdict: FAIL** on the criterion that section 8 set, L hit@5 not lower than 0.55. The search change does not
turn that into a pass, because hit@5 stays at 0.45. Section 4 asks that the step A hit rate is not lower,
and section 8 defines a hit as a printed note. On that measure the result is 0.69 against 0.55. The measure
changed from five printed hits to eight, so it is not the same test.

S hit@5 fell from 66 to 1 of 501. This is by design: step B4 moved the state files out of the index.

The change of L between the first two runs:

| transition | queries |
|---|---|
| hit before, hit after | 169 |
| hit before, miss after | 63 |
| miss before, hit after | 21 |
| miss before, miss after | 169 |

Of the 63 losses, 17 hits are now in `ext:mem-state`, which the score does not credit. Five have no live
target. 41 have a live note that doc-search did not print. The main confound is #5548, which merged
between the two runs and embeds large files. `briefs/RESIDUE.md` then took rank 1 on 52 of the 422 queries
and `tests/dex-tests.js` took rank 1 on 17. The truth also favours the old order, because a session read
what the old engine printed first.

The search change in `tools/xerj-query.mjs`:

1. The order is a reciprocal-rank blend of the fused order and the reranker order.
2. After the five hits, doc-search prints at most three memory notes that are not among the five.

Offline result over captured candidate pools, the same index, one day:

| order | repo queries hit@5 (of 52) | L queries hit (of 422) |
|---|---|---|
| fused, five hits | 45 | 195 (0.462) |
| reranker alone, five hits | 47 | not scored |
| blend, five hits | 49 | 196 (0.464) |
| two note slots inside the five | 44 | 258 (0.611) |
| blend, five hits and three notes | 49 | 296 (0.701) |

Kestrel set the three-note count after reading its holdout. The holdout is 264 queries that the pool capture
reached after the choice of the lane, and it scores 0.708. A slot inside the five costs repo hits, so the notes
come after the five.

## 11 · The note promotion: L hit@5 passes the floor

Owner, 2026-11-24: "especially raise 0.45". The order now puts at most two memory notes into the five
answers. A note takes the place of the lowest hit from outside the repo (a board post or a state file). A
displaced hit prints after the five, and a repo document keeps its place.

Kestrel stated the criterion before the study: live L hit@5 at least 0.55, each half at least 0.53, and at
least 47 of the 52 repo queries. Kestrel chose the order on the tune half and read the hold half once. The
study replayed captured candidate pools of the same 422 L queries.

| run | L hit@1 | L hit@5 | L printed | L refused | median output |
|---|---|---|---|---|---|
| shipped order, live 2026-11-24 | 56 | 192 (0.455) | 292 (0.69) | 4 | 3,897 B |
| note promotion, offline (tune 129/212, hold 123/210) | not scored | 252 (0.597) | not scored | not scored | not scored |
| note promotion, live 2026-11-24 | 72 | 252 (0.597) | 294 (0.70) | 3 | 3,953 B |

**Verdict: PASS** on the criterion of section 8, L hit@5 not lower than 0.55. S hit@5 stays at 1 of 501 by design.

The repo queries do not pay for it. Over the 52 queries of `audits/XERJ-BENCH-QUERIES.json`, two runs of each
order gave 49 and 48 (shipped), 48 and 49 (promotion). The vector search is not deterministic between runs,
so one query moves either way. The refusal floor passes: 39 of 40 off-topic queries refused, and no correct
answer refused.

Limits:

- The truth of stratum L is what a session read after the old engine answered. It favours the old order.
- The gain comes from places that board posts and state files held. Their hits print after the five.
- `doc2query` (questions generated per note, $6.63) gave no gain. Kestrel did not ship it.

One defect of the instrument: `tools/xerj-bench.mjs` read the semantic lane with a command that now answers
from the hybrid lane. Its `bge` row scored 0 of 52 with no error, so the acceptance line passed over nothing.
It now asks for the semantic lane, and an engine that does not answer makes the result `UNKNOWN`. A new `answer`
row scores the answer that doc-search prints.

## 12 · Second currency pass: the test

The first pass left 1,777 claims at "cannot tell", because the excerpts did not show the code. The second pass
finds excerpts by a search on each claim. A second model call then tries to overturn each outdated mark.

| test | notes | confirmed marks | right by hand | bar | result |
|---|---|---|---|---|---|
| first sample, no second call | 60 | 12 | 10 (0.83) | 0.85 | FAIL |
| second call, on the first sample | 60 | 8 | 8, and it dropped 2 of 10 right marks | keep 9 | FAIL |
| new sample with the second call | 120 | 16 | 15 (0.94) | 0.85, n at least 12 | PASS |

The third row is a new test on unseen notes, with its criterion stated before the pack. It is not a pass of the
first one. Its cost was $0.05 a note (bar 0.06) and 0.13 marks a note (bar 0.08). Two of the 15 right marks were
close calls. With both counted wrong, the result is 13 of 16 (0.81), below the bar.

Because of that, the full pass over the remaining notes applies no mark without a hand check.

## 13 · Second currency pass: the result

The full pass ran on 2026-11-24 over the 410 remaining notes, with 1,131 "cannot tell" claims. The first
model call cost $13.07 and the second call cost $8.11.

| step | marks |
|---|---|
| the first call marked outdated | 99 |
| the second call confirmed | 69 |
| the second call overturned | 27 |
| the second call answered "unclear" | 3 |
| Kestrel rejected after the hand check | 4 |
| applied from the full pass | 65 |
| applied from the two samples of section 12, right by hand | 25 |
| applied in total, in 81 notes | 90 |

Of the 69 confirmed marks, 65 were right by hand (0.94). A mark adds a dated line to the note and deletes nothing.
The same change unlinked 61 names that no note holds.

## 14 · STE holds on each new or changed note

Owner, 2026-11-24: "Should not we enforce it?" The memory repo now runs `tools/ste-lint.mjs` over each note that
differs from the merge base. CI, `land.mjs` and `inbox.mjs` run the check.

- A new note needs 0 findings.
- A changed note adds no finding to its count at the base.
- An untouched note is exempt. On 2026-11-24, 197 of 819 notes passed and 622 did not.

Kestrel rejected a rewrite of those 622 notes. A rewrite can change a measured lesson. No measurement here shows
that STE text is easier for a model, so the rule rests on the owner's order of 2026-10-11 and not on a result.

## 15 · Acceptance, checked 2026-11-24

- The hit rate is not lower: L hit@5 is 0.597 (252 of 422), and the criterion is 0.55 (section 11).
- `tools/check.mjs` of the memory repo reds an archive file that no live note supersedes and that states no reason.
- The same gate reds a secret, a private address and a home path. The secret scan covers this repo.
