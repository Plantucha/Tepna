<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED · **Created:** 2026-10-12 · **Relates:** `AHI-SURROGATE-REFIT-SIZING-2026-10-12-BRIEF.md` (PROPOSED, §5 and §8), `docs/SHHS-COHORT-REFERENCE.md`, `docs/CORPUS-LOCATIONS.md`

# Deriving an AHI from open-dataset annotations — 154 of 579 recordings, and the four sets that carry no respiratory event at all

The sizing brief put the open sets at "**842 EDFs**, none carrying a published AHI column", and sent the
derivation here as R3. The owner ruled that the open sets join the refit once this brief reaches DONE.
I walked the mount and counted. Both halves of that sentence need correcting, and the correction cuts
the usable set by three quarters.

**Search first (Rule 0):** `derive AHI from open-dataset annotations scorer agreement TST denominator`
→ `nsrr-adapter.js` · `ext:literature/10.3389_frsle.2026.1858267` · `tools/nsrr-ahiest-validate.mjs` ·
`AHI-SURROGATE-REFIT-SIZING-2026-10-12-BRIEF.md` · `docs/SHHS-COHORT-REFERENCE.md`. No derivation
brief exists yet.

## 1 · The inventory, measured

Root: **`/mnt/nas/nsrr/open-datasets`**. I counted files, not directory labels, on 2026-10-12.

| set | PSG recordings | other EDF in the tree | annotation files | respiratory events? |
|---|---|---|---|---|
| `hmc-sleep-staging` | **151** (`<id>.edf`) | 151 `<id>_sleepscoring.edf` | 151 `<id>_sleepscoring.txt` | no |
| `boas` | **128** (`sub-N…psg_eeg.edf`) | 128 `…headband_eeg.edf` | 256 `*_events.tsv` | no |
| `isruc` | **127** (`.rec`, zero `.edf`) | — | 254 `.xlsx` + 252 `.txt` | **yes** |
| `capslpdb` | **108** | — | 108 `.txt` + 108 `.edf.st` | no |
| `isleeps` | **40** | — | 40 `S<n>.xlsx`, 24 sheets each | **yes** |
| `ucddb` | **25** (`.rec`) | — | 25 `<id>_stage.txt` | no |
| **total** | **579** | 279 | | **167 recordings** |

Three corrections to §5 of the sizing brief:

- 858 EDF-family files sit under that root, not 842. The one differing cell is `isruc`.
- Only **579** of them hold a PSG recording. The rest are annotation containers and headband EEG.
- `isruc` holds **127** recordings, all with a `.rec` extension, and holds no `.edf` at all.

## 2 · ISRUC carries a full AASM respiratory vocabulary

The `.xlsx` beside each `.rec` has no header row, and its columns run positionally: A epoch number,
B sleep stage, E event, F body position. Column E holds the respiratory tokens.

Scorer-1 token totals over 126 workbooks: `OH` 3805 · `MH` 2700 · `OA` 1469 · `CA` 354 · `CH` 77 ·
`MA` 63. That is **8468 events**, spanning obstructive, central and mixed, apnea and hypopnea alike.

**Two parsing traps, both of which silently shrink the count:**

- Some cells carry a leading epoch integer — `66 AR`, `84 MChg`. A parser must strip `^\d+\s+`.
- A cell may list several tokens, and may repeat one: `AR,AR`, `OH,AR`. Split on comma and semicolon.

Skipping the first trap costs roughly a third of the tokens. Treating a cell as one event costs the
rest.

### 2a · The second scorer did not score respiration — and its zero is not a zero

ISRUC ships two scorings per recording, `<n>_1.xlsx` and `<n>_2.xlsx`. Only the first one holds
respiratory events:

| scorer | workbooks | workbooks with ≥1 respiratory token | tokens |
|---|---|---|---|
| 1 | 126 | **120** | 8468 |
| 2 | 126 | **5** | 159 |

Scorer 2 scored stages and arousals. Its empty respiratory column records **no scoring**, never an
absence of events. A derivation that pools or averages the two scorings halves every AHI it touches,
and that is the `∅ ABSENCE IS NULL` bug in its classic form.

**So this corpus offers no inter-scorer control on the respiratory events.** It offers one on staging,
and the derivation owes the refit that limit in writing.

### 2b · The derived distribution

Denominator: epochs whose column B reads `N1 N2 N3 N` or `R`, at 30 s each. Numerator: apnea plus
hypopnea tokens from column E, with the integer prefix stripped.

- **115 recordings yield an AHI.** 12 yield `null`: 11 where scorer 1 left no respiratory token, and
  one whose workbook carries no `_1` or `_2` suffix, so the tool cannot name its scorer.
- min 0.1 · p25 3.7 · **median 8.0** · p75 18.0 · max 67.5 · mean 12.8
- severity bands: 35 under 5 · 46 from 5 to 15 · 23 from 15 to 30 · 11 at 30 or above
- TST: median 6.00 h, range 0.84 h to 7.98 h

Those 12 nulls refuse the record. They do not round it to zero. An unscored recording must never reach the refit as an
AHI of 0. The suffix-less one holds 6 respiratory tokens, so its null says "no named scorer", not
"no events".

## 3 · iSleeps carries AASM event names outright

Each `S<n>.xlsx` holds 24 sheets. `Flow Events` and `SpO2 Events` are the respiratory ones, and both
name their events in plain language. Columns: A start, B end, C duration in seconds, D event name,
E sleep stage. Times arrive as Excel serial days.

Vocabulary over all 40 workbooks: `Hypopnea` 4260 · `Obstructive Apnea` 749 · `Central Apnea` 435 ·
`RERA` 53 · `Mixed Apnea` 32, plus `Desaturation` 246 on the SpO2 sheet. The `Obstruction` sheet holds
zero rows in every file.

**The AHI counts the four apnea and hypopnea names and leaves `RERA` out**, which belongs to an RDI.
The stage column places each event, and only 1.7 % of the 5450 event rows fall outside sleep.

- **39 recordings yield an AHI.** One yields `null`.
- min 0.1 · p25 9.8 · **median 20.4** · p75 36.0 · max 81.9 · mean 25.2
- severity bands: 4 under 5 · 9 from 5 to 15 · 11 from 15 to 30 · 15 at 30 or above
- TST: median 6.13 h, range 1.40 h to 8.41 h

### 3a · The null I nearly manufactured myself

`SN28.xlsx` has a `Flow Events` sheet of dimension `A1:D37`. **It has no column E.** My first pass
filtered events by sleep stage, found no stage on any row, and reported an AHI of **0.0** for a
recording holding 26 scored apneas and hypopneas.

An absent column read as "no events in sleep". That is the same bug as §2a, written by my own survey
script within an hour of my writing §2a down. The corrected pass returns `null` with the reason
`no-event-stage-column`, and the derivation tool must carry that check as a test.

## 4 · The four sets that carry no respiratory annotation

- **`hmc-sleep-staging`** — 151 scoring files, 7 distinct labels: five stages plus `Lights on` and
  `Lights off`. Staging only.
- **`boas`** — 256 `events.tsv`, columns `stage_hum` and `stage_ai`, at 30 s epochs. Staging only.
- **`capslpdb`** — "RemLogic Event Export"; the declared set is `MCAP-A1..A3` and `SLEEP-S0..S4`,
  `SLEEP-REM`, `SLEEP-UNSCORED`. A grep across all 217 text files returns zero respiratory tokens.
- **`ucddb`** — only bare per-line stage integers. The upstream `*_respevt.txt` files are absent here.

One near miss worth recording: a case-insensitive grep for respiratory vocabulary hits **104 `boas`
files**. Every hit is a `channels.tsv` row naming an `SPO2` **channel**. A channel name is not an
event, and a grep that counts one as the other would have put `boas` in §3.

`boas` having an SpO2 channel still matters. It makes those 128 recordings a target for a
**signal-based** instrument, which is a different brief and a different control.

## 5 · What the derivation tool must do

`tools/derive-open-ahi.mjs`, one record in and one record out, streaming per workbook under the 8 GB
rule.

1. **Name the root with every count.** The mount, the set, the file, and the recording id.
2. **Refuse, never default.** No respiratory scoring, no stage column, or no sleep epoch yields
   `null` plus a named reason: `no-respiratory-scoring`, `no-event-stage-column`, `no-sleep-epoch`.
3. **One scorer, named.** ISRUC uses scorer 1 for respiration. Record that choice in every row.
4. **Strip the epoch prefix, then split the cell.** §2 names both traps.
5. **Keep `RERA` separate** from the AHI numerator, and emit it beside the index.
6. **Emit the AASM subtype counts**, so a reader can rebuild an obstructive-only index.
7. **Emit one `tepna.verdict/1`** over the population it examined.
8. **Carry both source distributions as fixtures**, so a later parser change reds the gate.

The output feeds the refit through the existing sink `opts.scoredAHI` with `opts.ahiVar`, which
`nsrr-adapter.js:448-450` already reads. No new consumer surface.

## 6 · The pre-stated criterion

The derivation is a second instrument, so it owes a control before it calibrates anything. The
control is not an agreement with a published AHI, because no published AHI exists for these sets. The
control is **reproduction**: the tool must land on the counts this survey measured by hand.

```json
{ "schema": "tepna.verdict/1", "gate": "derive-open-ahi",
  "status": "NOT_RUN",
  "population": { "checked": 0, "eligible": 167, "excluded": 0 },
  "criterion": { "name": "survey_count_match", "threshold": 0, "unit": "records", "direction": "lte" },
  "result": null,
  "evidence": ["briefs/OPEN-DATASET-AHI-DERIVATION-2026-10-12-BRIEF.md"],
  "reason": "the tool does not exist yet; this brief states the criterion before the data",
  "producedBy": { "tool": "briefs/OPEN-DATASET-AHI-DERIVATION-2026-10-12-BRIEF.md", "commit": null },
  "at": "2026-10-12T00:00:00Z" }
```

`survey_count_match` counts the records where the tool and this brief disagree on the derived AHI or
on the null reason. The threshold is **0 records**. Any disagreement is a `FAIL`, and the tool
reporting more derived records than 154 is also a `FAIL`.

## 7 · Acceptance

1. `tools/derive-open-ahi.mjs` reproduces 115 ISRUC and 39 iSleeps AHIs, and the 13 nulls with their
   reasons.
2. A test covers the `SN28` shape: scored events, no stage column, result `null`.
3. A test covers the ISRUC epoch-prefix strip, with a fixture cell reading `66 AR`.
4. The tool refuses an unread argv token, as `tools/verify-fixtures.mjs` now does.
5. The verdict object validates, and `checked + excluded = eligible` holds.
6. `npm run check` passes, and `docs-ledger` passes with the `DOCS-INDEX.md` row in place.

## 8 · What this changes upstream

The sizing brief sized the open sets at 842 records. **154 recordings can carry a derived AHI**, so
the open sets add under a fifth of what that figure implied. Their value is the range, not the volume: ISRUC
sits at a median of 8.0 and iSleeps at 20.4, and together they span 0.1 to 81.9.

That spread is the argument for using them. The SHHS fit cohort is large and single-protocol, and
these two sets come from different labs, different scorers and different event-export software.

## 9 · Out of scope

- A signal-based AHI over the four annotation-free sets, including `boas` and its SpO2 channel.
- The zipped-only sets named in the sizing brief. Count those from the archive index, never a walk.
- Any change to `computeAHIestimates`. A coefficient change re-bundles OxyDex and stalens every
  folded night, so it must follow the trio re-fold rather than sit beside it.
- The two visit-level SHHS rulings. The owner settled those on 2026-10-12.
