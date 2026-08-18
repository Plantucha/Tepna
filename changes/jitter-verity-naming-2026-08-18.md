---
bump: patch
type: fixed
brief: PPGDEX-JITTER-AND-REFERENCE-FOLLOWUPS-2026-08-03-BRIEF.md
---

**`ppi-jitter-vs-ecg.mjs` could not see the Verity on the PSL corpus — and that silence is what made
§1's two reference figures look unreproducible.**

The armband is `Polar_VeritySense_<serial>` from the capture host and `Polar_Sense_<serial>` from Polar
Sensor Logger — one device, two spellings, identical serial. `--device verity` matched only the first,
so on the PSL tree it matched **0 of 1980 files** while **54** wrist PPG and **50** paired H10 ECG were
present, and reported *"nothing to report"*.

- Pattern now accepts both spellings. The repo already treated the PSL name as the Verity — PpgDex's
  equivalence input is `Polar_Sense_BBBBBBBB_20260621_060523_PPG.txt`.
- **Prints its denominator every run** — `N walked · N matched · N paired ECG` — and **exits 2 with a
  diagnosis** when nothing matches, instead of printing an empty table. An empty pattern and an empty
  corpus produce identical silence; only one is a fact about the data.

**§1 resolved on the re-run, n = 14 nights:**

| claim | recorded | measured | verdict |
|---|---|---|---|
| Verity PPI-jitter 5.92 ms | 8.36 ms (+41 %) | **median 6.09**, IQR 4.57–7.54 | reproduces |
| `sdnnRobust` within ~±3.5 % | +18.7 % | **median 1.84 %**, IQR 0.73–3.36 | reproduces |

Beat match rate median **100.00 %**.

**The shipped `sdnnNote` string does not owe a correction.** §1 flagged it as urgent *("it ships to users
as guidance")* on the strength of +18.7 %; at 1.84 % the claim is accurate. §5's 5.92 ms bound is
re-derived, not re-based — §5 was right to refuse to overwrite it.

Two nights sit high (15.13 ms at 94.5 % match; 11.70 ms), hence median and IQR rather than a mean.
