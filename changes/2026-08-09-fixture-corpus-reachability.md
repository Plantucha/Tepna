<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
brief: FIXTURE-CORPUS-REACHABILITY-2026-08-09-BRIEF.md
---
Files the collision between two rules that are each individually right. §👥.1 mandates a worktree for bundle/ledger/DSP work; §🔏 says that same work owes a `verify-fixtures` re-run — and a worktree holds **134 of the 653** files in `uploads/`, because **435 are gitignored** and exist only in the primary checkout. The failure presents as *"the corpus is absent"*, which reads as a machine fact and is a checkout fact; measured this session, the corpus was one directory up the whole time. Also records the four places the corpus actually lives (including that `Ecg nightly` contains a space, and that the freshest 4,247 files are on `vigil` over ssh, so regenerating a genuinely-moved fixture may be an ssh job) and that a busy compute path can re-open its own verification debt between incurring and discharging — filed as a cost, not a hole, since CI reports it and `release.mjs` refuses on it. Proposal 1's mechanism is verified rather than sketched: `git rev-parse --path-format=absolute --git-common-dir` resolves the primary checkout from inside a worktree, and degrades to `./uploads` elsewhere.
