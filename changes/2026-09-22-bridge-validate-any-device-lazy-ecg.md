---
bump: minor
type: changed
brief: none
---

`tools/ppg-bridge-hrv-validate.mjs` — the OLD-vs-NEW per-epoch PPG-HRV-against-chest-ECG validator — was O2Ring-only by file filter and re-parsed every ECG file in the tree for every PPG file (a Verity run sat 13 min pinned at an 8 GB cap scoring nothing). Now `--device o2ring|verity` (default unchanged), the ECG is chosen from an 8 KB head/tail span index and parsed once, `--new <ref>` lets OLD/NEW bracket a single commit, `--fires gap|any` scores changes that act outside §4, and every skip is named. First use: the `correctRR` fill removal (#2333) measured on the box's Verity nights — the finger-vs-ECG rMSSD gap widens on 33/38 files (`audits/PPG-FILL-REMOVAL-VERITY-2026-09-22.json`, residue `2026-09-22-fill-removal-widens-verity-rmssd-gap`).
