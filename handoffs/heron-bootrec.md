<!--
  heron-bootrec.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
# Handoff — unit 120 `bootrec` (Heron, 2026-10-28)

## 1 · Unit

Kestrel ordered the decision record for residue row
`2026-10-27-o2ring-recording-axis-has-no-boot-recovery`. The row waits on an owner decision, so this
unit writes the record and no code.

## 2 · Branch and worktree

Branch `claude/bootrec-hrn` in the worktree `../wt-bootrec-hrn`, cut from `origin/main` at `028691a17`,
head `915f16a64`. Three commits carry the brief, the index row and this note. DRAFT **#4083** holds
them, and another session must undraft it.

## 3 · Exact stopping point

`briefs/O2RING-BOOT-RECOVERY-DECISION-2026-10-28-BRIEF.md` holds all seven sections. `ste-lint` reads
0 findings over 79 prose lines, twice. `DOCS-INDEX.md:295` carries the row. `npm run check` reads
EXIT=0 over all 41 steps. The owner question is board entry **#2071** on thread 7.

## 4 · Next step

The owner chose option B on 2026-10-28, and Kestrel ordered the sequence. Unit 121 builds the full
recovery with the numeric column. Unit 122 wires `confirm_end` in the pull path. Both wait for #4083
to merge, and Kestrel undrafts it.

## 5 · Open questions

None remain in this unit. The owner answered both: option B, and `confirm_end` gains a caller as its
own unit. §6 of the brief records the ruling.

## 6 · Blockers

Unit 121 ships code and restarts no daemon, because a deploy to vigil stays owner-only. Row
`2026-10-28-end-confirmed-has-no-producer-outside-its-tests` rides this PR and reads OPEN until unit
122 closes it. Every landing PR appends to `RESIDUE.md`, so this branch conflicts with any other PR
that touches the ledger.

## 7 · The doc-search query

`node tools/doc-search.mjs --read "O2Ring recording axis boot recovery oxy_lifecycle OXYLIFE restore
across host restart"` returns `audits/PARKED-BLOCKERS-REVERIFY-2026-09-25.md:26-31` first, then the
harvest-refinement brief's §10.

## Measurements this unit made on vigil, read-only

| measurement | value |
|---|---|
| recording windows in 66 journals | 688, all closed |
| recorded time | 403.1 h |
| daemon starts inside a recording window | 0 of 427 |
| `END_CANDIDATE` dwell | p50 3.3 s, p90 39.2 s |
| `END_CONFIRMED` occurrences | 0 of 363 candidates |
