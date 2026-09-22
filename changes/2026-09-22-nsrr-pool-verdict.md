---
bump: patch
type: changed
brief: VERDICT-CONTRACT-2026-09-21-BRIEF.md
---

tools/nsrr-score-pool.mjs — the emitter for every pool scorer — writes one tepna.verdict/1 into its results file and prints it: a scorer decides only through its own pre-stated `CRITERION` + `verdict()` exports, and a scorer that declares none is UNKNOWN with the statistic in `result`, never PASS (the aai/ahiest/oxstat scorers ran before any band was stated); `--verdict-sample` for the adoption gate; manifest row adopted.
