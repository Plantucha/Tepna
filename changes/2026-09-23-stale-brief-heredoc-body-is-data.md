---
bump: patch
type: fixed
brief: none
---

guard-stale-brief no longer denies two correct actions: it strips non-interpreter heredoc bodies before matching, so quoting a guarded path — or a sed -i — as prose no longer reads as editing it; interpreter heredocs stay visible, and a parity leg pins the rule byte-identical to guard-shared-tree's. It also stops denying the resolution edit of a merge in progress, whose upstream commits are already in the tree.
