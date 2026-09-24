---
bump: patch
type: fixed
brief: none
---
An absent subjective Stress entered HRVDex's windows as a real **0**, because `!isNaN(null)` is TRUE — null coerces to 0. The visible cost is the all-absent week: `stress7.length` counted seven absent days while their values contributed nothing, so `d_stress_auc` summed them to **0** — "no stress" — for a week carrying no subjective data at all. Every ECGDex/Ganglior-ingested row lacks that column, so this is the COMMON case rather than an edge. The 14-day autocorrelation had the same coercion: absent days were admitted as 0 and correlated against each other.

The sibling ONE LINE BELOW the 7-day filter was repaired for exactly this and names the mechanism — *"§2 (FOLLOWUPS): drop absent (null), KEEP a real 0 … `!isNaN(null)` was true → a blank pNN50 polluted the slope as 0"*. `rmssd7`/`sdnn7` are safe only because `v > 0` happens to exclude null. `stress7` was the sibling that pass did not reach. Both sites now use `Number.isFinite`, which drops absent and keeps a real 0 — a legitimate Stress reading.

⚠️ Also corrects a STALE FIXTURE STAMP on a different node, caused by my own #2962: its `verify-fixtures` run happened before that PR's final conflict rebuild, so `provenance/ECGDex.json` landed on main recording `verifiedUnder: ab7894f23976` for a bundle whose current computeHash is `401c7cfe2007`. That fixture has been effectively UNVERIFIED on main since, and `tools/release.mjs` refuses to cut a release while a corpus-backed fixture is unverified. The green run in this PR is the authoritative re-verification; the correction is one line and is called out rather than folded in silently.
