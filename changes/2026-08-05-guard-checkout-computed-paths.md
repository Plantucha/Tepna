<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: DEEP-AUDIT-V-FOLLOWUPS-2026-08-05-BRIEF.md
---
The source-checkout guard extracted a path TOKEN from the command, so it only saw spellings that print one — and stayed silent on its own worked example. `git checkout origin/main -- $(git diff --name-only --diff-filter=U)`, the line CLAUDE.md §2c prints verbatim and calls hook-denied, and the line that dropped a test group, a DSP fix and a provenance entry from one commit, was measured ALLOWED on main; so were the backtick and `| xargs` forms, and all of `--ours`/`--theirs` (which name no ref, so the ref clause never fired, though taking one side wholesale is exactly the operation the rule refuses). Documentation promised a guarantee the guard did not implement, which is worse than no guard because people rely on it. A computed path list now fails CLOSED, agreeing with `tools/rebase-safe.mjs` classify(). Also fixes the mirror-image defect: paths were read from the whole command rather than the checkout's own segment, so an unrelated `.txt`/`.sh` in a `&&`-joined step refused ordinary compound commands. The test matrix gains an INTENTIONALLY RELAXED section so a deliberate loosening is stated and justified per line instead of being indistinguishable from the three regressions the one-way ratchet has caught.
