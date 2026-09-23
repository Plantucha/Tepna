---
bump: patch
type: added
brief: RESIDUE 2026-09-23-wt-done-cannot-be-told-the-pr-landed
---

A branch retried under a new name was permanently unreclaimable by the sanctioned path: `wt-done`
looks the PR up by branch name, finds none, refuses with `no PR found for branch`, and `--force`
deliberately does not override that. The refusal is right — that is the one case where forcing
loses the only copy — so the gap was that there was no way to supply the proof the tool approximates.

`--pr <N>` supplies it. It weakens no check: the PR must still be MERGED, the tree still clean and
idle, and the post-merge commit scan still runs against that PR's merge time. The flag only says
which PR to read, and the tool verifies the branch is a rename of the one that PR merged under
(`namesRelated`, with a floor so the shared `claude/` stem cannot satisfy it alone).
