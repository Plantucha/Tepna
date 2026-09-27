---
bump: minor
type: added
brief: PPG-FOOT-PLACEMENT-FOLLOWUPS-2026-09-01-BRIEF.md
---

The PAT tools can time ECG R-peaks on the H10's own sample counter: `ecgRpeakTimes(text, { axis: 'counter' })` and `--ecg-axis counter` on `pat-window-oracle`, `pat-three-corner` and `pat-drift-attribution` (the latter two gain `--ecg-axis` for the first time). The default stays `linear` (`t0 + i/fs`), so no published number moves. `linear` uses one whole-file `fs`, and the H10's sample rate differs between worn and off-body stretches; on 2026-09-25 that walked the ECG train 1.68 s against the PPG trains and showed up as a sawtooth PAT "drift". On the counter axis that night's PAT is flat (chest→finger 421 ms, window IQR 11 ms). Residue `2026-09-26-pat-ecg-index-axis-is-not-the-h10-sample-clock` carries the measurements and the open default decision.
