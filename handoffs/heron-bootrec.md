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

Wait for the owner's choice between options A, B and C. Then stamp the status line with that choice
and open the build unit. Nothing else in this unit remains.

## 5 · Open questions

The owner holds three: which option, whether `confirm_end` gains a caller, and what a tripwire does
when it fires. §6 of the brief states them.

## 6 · Blockers

The row forbids boot-recovery code before the decision. Deploys to vigil stay owner-authorized, and
this unit deploys nothing. The `END_CONFIRMED` finding needs a residue row, and that row waits for a
free PR slot.

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
