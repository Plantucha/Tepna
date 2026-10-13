<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->
# Glossary — one approved term for each thing

The writing rules come from **ASD-STE100 (Simplified Technical English), Issue 8, 2021**. This file is
the **approved-word layer**, and it is ours.

⚠️ **ASD copyrights its dictionary, and this file copies none of it.** We adopt the rules. Every
approved term below comes from this repository. Each choice names the form the repository already uses
most, and `git grep -ioF <term> briefs/*.md` gives the count.

`tools/ste-lint.mjs` reads this file. It reports a term from the retired column, and it names the
approved form beside it.

## Approved terms

| approved | retired | why this one |
|---|---|---|
| `re-bundle` | `rebundle` | 1378 against 4 |
| `fixture` | `golden` | 2407 against 517 — `golden` survives only inside a tool name such as `regen-oxydex-goldens.mjs` |
| `worktree` | `work tree` | 200 against 2 |
| `node-export` | `node export` | 430 against 42 |
| `capture-host` | `capture host` | 1176 against 73 |
| `sink` | `injection point` | 83 against 1 |
| `measured value` | `proxy` | CLAUDE.md §🎫 retires `proxy`; the ladder word is `measured` |
| `derived metric` | `composite` | CLAUDE.md §🎫 retires `composite` |
| `validated` | `provisionally validated` | CLAUDE.md §🎫 retires the hedge; the ladder has five ranks and no sixth |
| `refuses` | `bails`, `gives up` | the §∅ word for a named absence |
| `absent` | `missing` | `null` is a value; absence is the condition. **`empty` is NOT retired** — an empty list and an absent list differ, and retiring the word produced four findings against correct English in CLAUDE.md on the first run |

## The evidence ladder

Five ranks, and no others: **measured · validated · emerging · experimental · heuristic**. A rank is a
node fact and lives in `<node>-registry.js`.

## Technical names

A technical name keeps its form. The linter reports none of these as a verb-noun.

| name | kind |
|---|---|
| `OxyDex`, `HRVDex`, `PulseDex`, `PpgDex`, `GlucoDex`, `ECGDex`, `CPAPDex`, `MotionDex`, `Integrator` | technical name — the nodes |
| `Ganglior` | technical name — the bus codename, FROZEN |
| `Tepna` | technical name — the brand |
| `O2Ring`, `H10`, `Verity`, `VeritySense`, `AirSense` | technical name — devices, from `capture-host` config |
| `DexClock`, `MetricRegistry`, `PPGDSP`, `ECGDSP` | technical name — module globals |
| `manifestHash`, `computeHash`, `verifiedUnder` | technical name — provenance fields |
| `tMs`, `t0Ms`, `offsetMin`, `hostAxis`, `relSec` | technical name — Clock Contract fields |
| `finding`, `recording` | technical name — a gate's unit of output (`ste-lint`, `residue-ids`, CLAUDE.md §📚 "never silence a finding") and the capture unit (`recording.startEpochMs` in the export contract) |

## What the rules are

1. A sentence in a procedure holds **20 words or fewer**. Elsewhere, **25 or fewer**. An imperative is
   a procedure, inside a list or not.
2. Write in the **active voice**.
3. Use a verb as a verb. Do not make a noun from it with `-ing`.
4. One instruction for each sentence.
5. A paragraph holds **six sentences or fewer**.
6. Use the approved term. The retired column names what to replace.

The linter skips fenced code, tables, quoted log lines, citations, URLs and inline code. It must not
rewrite evidence, and a long identifier is not a long sentence.
