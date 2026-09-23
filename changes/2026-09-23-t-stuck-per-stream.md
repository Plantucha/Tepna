---
bump: minor
type: added
brief: none
---

`tools/stuck-run-lengths.mjs` measures the run-length distribution of a capture stream against `writers.T_STUCK`, with the criterion pre-registered in its header before any stream was read. It answers residue `2026-09-06-t-stuck-validated-on-ring-only`: across ~550 M samples per stream, **zero runs reach 200 samples** on Verity PPG, Verity ACC, H10 ACC or the ring's `ppg2w`, so the corpus cannot validate the constant in either direction on any stream it was silently extended to — NOT-EXERCISED, and no constant is proposed. The false-positive direction is excluded by one to two orders of magnitude (200 sits at 100×/33×/12×/100× the plateau p99.99 against the 4.17× it was designed at); the false-negative direction, which is the row's actual risk, is untestable from a corpus containing no stuck spans. Full per-channel verdicts in `audits/T-STUCK-PER-STREAM-2026-09-23.json`.
