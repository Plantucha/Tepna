---
bump: minor
type: added
brief: NIGHT-IS-THE-RECORDING-2026-10-05-BRIEF.md
nodes: [analysis]
---

`tools/withdraw-fragment-verdict.mjs` withdraws a verdict that judged a FRAGMENT of one recording, with
its reason recorded — NIGHT-IS-THE-RECORDING §⑥.

One recording can land in two night folders, and the judge then emits a verdict per folder. The later
folder holds only the reconnect tail, so its verdict judges a fragment: 2026-10-05's QC reported
`missing stream(s): Wellue O2Ring-S:spo2` for a night on which the ring ran 22:00 → 04:39.

**Nothing is deleted; the withdrawal is a record.** Removing the verdict would repeat the defect the brief
names at §②(b), where six pre-recording verdicts were overwritten and the trail survived only in the
journal. So a sibling `<NAME>-VERDICT.withdrawn.json` carries the original object VERBATIM, the reason,
the recording it belonged to, and who withdrew it.

Dry-run is the default and `--apply` is required to write. It refuses rather than guessing which folder is
the fragment: the caller names both, because inferring them would re-derive the recording-grouping rule
that lives in `night_band` and two implementations of one definition drift apart. Idempotent by the record
beside the file, not by a flag; an unreadable verdict is refused rather than withdrawn with an empty body.

The brief also lands the recording's definition verbatim from Magpie's mirror measurement: the maximal
chain clipped to the night band it begins in — which is what makes the two-folder bound structural (111
night recordings: 61 one folder, 50 two, 0 three) where unclipped chains gave four spanning 3–4 folders.
