---
bump: minor
type: fixed
brief: none
---

Two root causes in guard-shared-tree.sh, fixed together because they share a file and compose. (1) A heredoc BODY is data, so it is stripped for every rule rather than only for `commit` — a heredoc feeding an interpreter stays raw because that body is a program, and quote-stripping stays commit-only because quotes after `bash -c` are code. The residue's stated remedy (strip quotes for every rule) was measured first and REFUSED: it would have made `bash -c "<blanket add>"` and `bash -c '<force clean>'` invisible. One fail-closed implementation now serves every rule instead of the rebase rule keeping a private copy. (2) A denial names the clauses it cancelled: a PreToolUse hook cancels the whole Bash call, and the reportable property is the SILENCE about the cancelled work, not the breadth — the measured instance was a `gh pr create` chained ahead of a rightly-denied removal, which never happened and said nothing. The test harness's origin/main comparison is kept and strengthened: `chk allowNEW` names an intended relaxation per case and asserts main really did deny it.
