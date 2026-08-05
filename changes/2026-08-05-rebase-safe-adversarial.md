<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: DEEP-AUDIT-V-FOLLOWUPS-2026-08-05-BRIEF.md
---
An adversarial pass over the rebase guard found three holes review had not: the `--source=<ref>` EQUALS form bypassed the hook entirely (the rule only looked for a ref after whitespace), a traversing path walked out of the classifier's `provenance/` prefix test and read as GENERATED, and the rule false-positived on any command whose heredoc merely DESCRIBED the pattern — it blocked the commit that was shipping it. All three fixed and pinned. Adds `npm run rebase` plus a CONTRIBUTING row, because a control nobody can find is not a control.
