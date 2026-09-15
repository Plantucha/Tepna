---
bump: patch
type: fixed
brief: none
---

The AAI card invited a reading its own numbers do not support, and nobody had ever measured the gap.

`OxyDex Reference.html` titles the metric **Autonomic Arousal Index (events/hr)** and the UARS scoring
block compares it to a threshold written as *"autonomic arousal index ≥ 3/hr"*. Both read as the clinical
quantity an EEG scorer produces. The metric is graded `heuristic`, and its registry note says why —
*"internal"* — which records that nothing external had checked it, not what would happen if something did.

SHHS1 carries the reference it lacked. Measured over **492 usable pairs of 500 records** scored through
the shipped OxyDex path (`tools/nsrr-score-pool.mjs --scorer ./nsrr-aai-validate.mjs`, landed #2523):

| | |
|---|---|
| AAI | median **4.53 /hr** |
| expert-scored cortical arousal index | median **19.46 /hr** |
| ratio | **0.236** ±0.031 |
| Spearman r | **0.414** (Pearson 0.456) |

**AAI runs at roughly a quarter of the scored arousal index, and ranks nights only moderately.** Neither
half of that is a defect: AAI counts autonomic arousals visible in heart rate, which are a genuine
*subset* of the cortical arousals an EEG scorer marks, so a ratio well below 1 is the expected shape. The
defect was that a reader had no way to know it — the card offered a formula, a unit, and an interpretation
guide, and no indication that the number is not interchangeable with the clinical index it is named after.

The card now states the measured relationship. **The evidence tier is unchanged at `heuristic`, deliberately**:
validating a construct's relationship to a reference does not make the construct validated, and §🎫's rule
against upgrading a badge on prose applies just as much to upgrading it on a correlation of 0.41.

Filed as residue `2026-09-15-aai-normalisation-saturates` rather than fixed here: the same run shows AAI's
`/5` normalisation sitting at its ceiling on **45.3 %** of these records, which matters because NSI weights
that term at a full quarter of the score. That is a real observation and it is **not** grounds to retune the
constant — SHHS1 is attended PSG on an older cohort and OxyDex's users are home O2Ring wearers, so the
instrument is shared and the population is not. Measuring the same fraction on the home corpus is what is
owed first. The card change needs no such argument, because it states a measured relationship instead of
moving a threshold.
