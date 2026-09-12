---
bump: patch
type: changed
nodes: [suite]
brief: STRATEGIC-PRIORITIES-2026-08-26-BRIEF.md
---

§P5's public-benchmark gate is recorded as covering PUBLICATION, not MEASUREMENT.

Owner ruling 2026-09-12. Running a public-benchmark instrument internally and acting on what it
finds is permitted now — a benchmark that exposes a real DSP defect is an ordinary bug report and an
ordinary PR. Only quoting a rate outside the repo stays gated.

The "~2 weeks of error-free operation" criterion is deliberately NOT mechanised: three checkable
versions were offered (consecutive clean capture nights · no new data-integrity residue · a
conjunction with PAT) and all three were declined in favour of keeping it a judgment call. A session
must ask rather than evaluate a proxy, and must never read a green proxy — nights folded, commits
landed, CI passing — as the gate having opened.

Recorded in the brief and in both surfaces that previously stated only the prohibited half
(`tools/ecg-physionet-differential.mjs`, `docs/ECG-PHYSIONET-DIFFERENTIAL-README.md`), which a
reader could reasonably have taken as "do not run it at all".
