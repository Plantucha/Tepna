---
bump: patch
type: fixed
brief: none
---

**Both fused tools now read the capture host's filenames, so the Ledger's ✓ is a click that
processes.** `sensor-trio-power-analysis.js` and `pat-feasibility.js` classified recordings by the
phone-app names — `Polar_H10_<id>_YYYYMMDD_HHMMSS_<KIND>.txt`, `Polar_Sense_…`, `O2Ring…_<14>.csv` —
and the box writes the same bytes as one 14-digit run with no separator, `Polar_VeritySense_…`, and
`Wellue_O2Ring-S_<serial>_…_SPO2.csv`. 0 of a box night's 134 files matched; both tools opened to
"0 nights indexed". The stamp is now `(\d{8})_?(\d{6})` — one pattern per role for both layouts —
and the ring's box `_SPO2.csv` is the hat's `o2` role.

The click needed more than the regexes. The hat's eligibility is `o2 && h10 && verity`, and the
monitor sent it ECGDex's and PPGDex's files — never OxyDex's CSV, the only file its `o2` role reads —
while the index's ✓ required the ring's raw `_PPG.txt`, a file the tool never opens. `nightFilesFor`
now includes the ring CSV and the index requires `_HR.txt` + Verity `_PPG.txt` + `_SPO2.csv`, so ✓
means the tool can run. Routes for both tools name `#fileInput`; the ✓ pill and the Capture page's
Open ▸ are clicks again, and the routes-equals-clickable equality now counts the derived tools.

The tripwire `test_the_tool_classifiers_still_reject_box_filenames` fired as designed and is
inverted into the regression guard `…accept_box_filenames`: every box name a tool has a role for
must match one of its stamp regexes, read from the tool's own `classify` body; names no regex covers
are asserted still rejected, so the widening is not a wildcard. Decoy verified.

Fleet-Session: Magpie
