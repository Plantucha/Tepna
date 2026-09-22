---
bump: patch
type: changed
brief: VERDICT-CONTRACT-2026-09-21-BRIEF.md
---

Eight band-less analysis tools (acc-acc-control · cpap-oxy-couple · pat-ppg-ppg-control · pulse-agreement · tch-estimator-bakeoff · tch-multinight · tch-per-epoch-rho · tch-third-corner) emit tepna.verdict/1 status UNKNOWN by design through one shared builder (`tools/verdict-undeclared.mjs`): a threshold derived from the data it judges is UNKNOWN, not PASS; the statistic rides in `result`, in-code rules are fields never statuses, `--verdict-sample` on each; manifest rows adopted.
