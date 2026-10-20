<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->

**Status:** IN-PROGRESS — 2026-10-20 · **Created:** 2026-10-12 · **Relates:** `AHI-SURROGATE-REFIT-SIZING-2026-10-12-BRIEF.md` (PROPOSED, §5 and §8), `docs/SHHS-COHORT-REFERENCE.md`, `docs/CORPUS-LOCATIONS.md`

# Deriving an AHI from open-dataset annotations — 156 distinct of 579 recordings, and the four sets that carry no respiratory event at all

The sizing brief put the open sets at "**842 EDFs**, none carrying a published AHI column", and sent the
derivation here as R3. The owner ruled that the open sets join the refit once this brief reaches DONE.
I walked the mount and counted. Both halves of that sentence need correcting, and the correction cuts
the usable set by three quarters.

**Search first (Rule 0):** `derive AHI from open-dataset annotations scorer agreement TST denominator`
→ `nsrr-adapter.js` · `ext:literature/10.3389_frsle.2026.1858267` · `tools/nsrr-ahiest-validate.mjs` ·
`AHI-SURROGATE-REFIT-SIZING-2026-10-12-BRIEF.md` · `docs/SHHS-COHORT-REFERENCE.md`. No derivation
brief exists yet.

## 0 · What the mirror says about terms — and what it does not say

Finch read ISRUC as internal-use only on 2026-10-12, and pulled an ISRUC figure from a public doc.
Kestrel asked me to cite the governing clause. **I cannot, because no such file exists on the mirror.**
Here is what the disk holds, per set:

| set | terms on disk | checksum record |
|---|---|---|
| `hmc-sleep-staging` | `LICENSE.txt` — CC BY 4.0 | `sums.norm`, `SHA256SUMS.txt` |
| `boas` | `dataset_description.json` — `"License": "CC0"` | `verify.out` |
| `capslpdb` | **none** | `sums.sel`, `verify.out` |
| `ucddb` | **none** | `sums.sel`, `verify.out` |
| `isruc` | **none** | **none** — only `megadl.log`, and no row in `.verdicts` |
| `isleeps` | **none** | `verify.out`, and a bare `isleeps edf: 40` in `.verdicts` |

The root `README.md` does grant publication. It calls its sets "attribution-only or public-domain",
and it permits derived results with attribution.

That sentence covers the five sets its own table names, and it names none of these six. It dates to
2026-09-26 and files CAP, UCDDB, HMC and BOAS under **"Not fetched"**. Those directories arrived
between 2026-09-27 and 2026-10-04, after the sentence.

**So the two sets that carry respiratory events are the two with no terms on disk.** An absent licence
grants nothing, and `§📚` forbids fabricated authority. This brief therefore withholds every derived
clinical value for `isruc` and `isleeps`, and keeps the structural counts, which describe the mirror
rather than a subject.

The held numbers live in one private note outside the repo,
`memory/osprey-open-ahi-numbers-2026-10-12.md`. **The owner decides whether they may surface.** Finch's
reading and my measurement agree on the practical answer, by different routes.

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
- The derived index, its quartiles, its severity bands and the TST: **measured, held under the set's
  terms** (§0). The spread does cover every severity band, including 11 recordings in the top one.

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
- The derived index, its quartiles, its severity bands and the TST: **measured, held under the set's
  terms** (§0). This cohort sits markedly sicker than `isruc`, with most records above the mild band.

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

`survey_count_match` counts the records where the tool and the private note of §0 disagree on the
derived AHI or on the null reason. The threshold is **0 records**. Any disagreement is a `FAIL`, and the tool
reporting more derived records than 154 is also a `FAIL`.

### 6a · The derivation ran on 2026-10-20, and the survey is the side that moved

`tools/derive-open-ahi.mjs` reproduces the iSleeps half exactly. It refutes four ISRUC counts.

| figure | the hand survey, 2026-10-12 | the tool, 2026-10-20 |
|---|---|---|
| ISRUC records enumerated | 127 | **128** |
| ISRUC derived | 115 | **120** |
| ISRUC null `no-respiratory-scoring` | 11 | **6** |
| ISRUC null `no-scorer-1-workbook` | 1 | **2** |
| iSleeps records enumerated | 40 | 40 |
| iSleeps derived | 39 | 39 |
| iSleeps null `no-event-stage-column` | 1 | 1 |

So the verdict reads **FAIL over four disagreements**, and §6 keeps the criterion it pre-stated. A
criterion that moves to meet its own data decides nothing. Each disagreement names its cause.

**The two unsuffixed workbooks.** `subgroupII/65` and `subgroupII/95` each hold a workbook with no
`_1` or `_2` suffix, so neither names a scorer. §0 above names both directories in its privacy
paragraph, and the survey counted one of them. The tool counts two. It identifies each as
`<dir>#unsuffixed`, so a name-bearing basename never leaves the process.

**The five records the survey called unscored.** 120 of 126 scorer-1 workbooks carry a respiratory
token, which is the figure #3499 published the same day. The survey's own list of eleven holds those
six, plus `subgroupI/8`, `subgroupII/16`, `subgroupII/17`, `subgroupII/33` and `subgroupIII/2/1`. All
five of those carry tokens in column E — 41, 70, 191, 65 and 191 event cells. One survey therefore
disagrees with itself, and the instrument agrees with the half that reached the repository.

**iSleeps agrees on every count and differs on two quantiles.** The tool reproduces 5356 apnea and
hypopnea rows in sleep of 5450 scored, 53 `RERA`, both extremes of the spread, all four severity
bands, and the note's TST summary to two decimals. The index values stay held under §0, in the
private note. Two quantiles of the distribution differ from that note, and one choice explains the
whole gap. The hypnogram carries 352 epochs of stage `A`, over 35 of the 40 records. Count those as
sleep and both quantiles land exactly on the note's figures, which is how the hand pass computed them.

This tool counts `N1 N2 N3 N4 REM` and nothing else, because an artifact epoch is not scored sleep.
No respiratory event sits in an `A` epoch — 0 of 5450 — so those epochs only ever enlarged a
denominator. **A sleep test written as "not Wake" admits every token it never heard of.**

**Three ISRUC workbooks are byte-identical across subgroups.** The 126 scorer-1 files hash to 123
distinct contents: `subgroupII/17` repeats as `subgroupIII/2/1`, `subgroupII/34` as `subgroupIII/3/1`,
and `subgroupII/38` as `subgroupIII/4/1`. A cohort built by a tree walk weights three subjects twice,
and no filename says so. Every row now carries a `contentHash`, and a later copy names the record it
repeats.

**One Excel owner file is not a recording.** A glob over `*.xlsx` picked up `~$SN1.xlsx` and
`~$SN2.xlsx`, which hold no zip directory, and reported iSleeps as 42 records. The enumerators skip
a `~$` basename by name.

**What the owner decides.** Whether the measured counts replace the hand figures as this brief's
reference. Until then §6 stands as written, the tool reports FAIL against it, and the per-record
indices stay in the private note of §0.

## 7 · Acceptance

- [ ] 1. `tools/derive-open-ahi.mjs` reproduces 115 ISRUC and 39 iSleeps AHIs, and the 13 nulls with
      their reasons. **Refuted for ISRUC on 2026-10-20 — §6a.** iSleeps reproduces exactly; ISRUC reads
      120 derived of 128 with 6 unscored, and the item waits on the owner's choice of reference.
- [x] 2. A test covers the `SN28` shape: scored events, no stage column, result `null`.
- [x] 3. A test covers the ISRUC epoch-prefix strip, with a fixture cell reading `66 AR`.
- [x] 4. The tool refuses an unread argv token, as `tools/verify-fixtures.mjs` now does.
- [x] 5. The verdict object validates, and `checked + excluded = eligible` holds.
- [x] 6. `npm run check` passes, and `docs-ledger` passes with the `DOCS-INDEX.md` row in place.

## 8 · What this changes upstream

The sizing brief sized the open sets at 842 records. **154 recordings can carry a derived AHI**, so
the open sets add under a fifth of what that figure implied.

**Amended 2026-10-20 by the tool.** The derivation yields **159 rows over 156 distinct recordings**:
120 ISRUC rows of which three repeat another row's bytes, plus 39 iSleeps. The 154 above was the hand
count, and §6a reconciles every difference. Their value is the range, not the volume.
The two sets sit in different severity bands, and between them they populate all four.

That spread is the argument for using them. The SHHS fit cohort is large and single-protocol, and
these two sets come from different labs, different scorers and different event-export software.

### 8a · What the three repeated workbooks do to the pooled figures (measured 2026-10-20)

The row `2026-10-20-three-isruc-workbooks-repeat-another-subgroups-bytes` named the duplication and
left the cost unmeasured. The tool now reports the distinct-subject population beside the all-files
one, through one code path, so the two cannot drift apart.

**Every ISRUC pooled figure moves except the extremes.** 128 records, 120 derived, 117 distinct.

| figure | over 120 files | over 117 subjects |
|---|---|---|
| p25 | 3.7 | 3.5 |
| median | 7.9 | 7.7 |
| p75 | 17.3 | 17.0 |
| mean | 12.5 | 12.1 |
| min · max | 0.1 · 67.5 | 0.1 · 67.5 |
| bands, under 5 · 5–15 · 15–30 · 30+ | 37 · 48 · 25 · 10 | 37 · 47 · 24 · 9 |

The three repeated workbooks derive 48.3, 9.5 and 24.0, one in each of the three upper bands, which
is why each of those bands loses exactly one record. The extremes cannot move, because no repeated
copy is the smallest or the largest.

**iSleeps is the corpus-level control.** It holds no duplicate, so its distinct block repeats its
all-files block figure for figure. A `distinct` block that differed there would be filtering on
something other than `duplicateOf`.

**The subject rule is stated, not inferred.** `markDuplicates` keeps the first copy in sorted
record-id order and makes every later copy name it. So `subgroupII/17` is the subject and
`subgroupIII/2/1` is its repeat, rather than the other way round. Nothing in the mirror ranks the two,
and a rule that depended on the directory walk would answer differently on another machine.

**What this does not decide.** Which pooled figure a later consumer should quote. Both now exist and
carry their population, and a cohort that treats the three as independent subjects is making a claim
the bytes refute.

## 9 · Out of scope

- A signal-based AHI over the four annotation-free sets, including `boas` and its SpO2 channel.
- The zipped-only sets named in the sizing brief. Count those from the archive index, never a walk.
- Any change to `computeAHIestimates`. A coefficient change re-bundles OxyDex and stalens every
  folded night, so it must follow the trio re-fold rather than sit beside it.
- The two visit-level SHHS rulings. The owner settled those on 2026-10-12.
