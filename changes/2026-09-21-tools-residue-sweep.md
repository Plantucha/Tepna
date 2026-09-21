---
bump: patch
type: fixed
brief: none
---

Three tools/ residue rows fixed: a shared Playwright launch (tools/pw-launch.mjs) that keeps the sandbox where it works and relaunches --no-sandbox only on the AppArmor user-namespace failure, naming it; pat-fiducial-jitter stratifies by sample rate and quotes each SD's size in samples instead of scaling every file by the last file's fs; trio-batch reports a 3-bpm quality statistic beside the 15-bpm HR fault gate.
