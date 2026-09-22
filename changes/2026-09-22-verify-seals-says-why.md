---
bump: patch
type: fixed
brief: none
---

`tools/verify-seals.mjs` emits `producedBy.commitReason` when `commit` is null, instead of throwing `producedBy.commit is null without producedBy.commitReason (∅: say why)` — which it did on every run outside a git tree, including inside every mutation scratch. Its own comment had called the reason "implicit"; the contract requires it stated. The node-side parity of `test_seal.py`'s existing Python assertion comes with it, and fails against the pre-fix tool.
