---
bump: minor
type: added
brief: none
---

`tools/unit-start.mjs` prints what a session reads at the start of a unit in one output. The output has six sections:

1. the handoff fields;
2. the ref and the branch;
3. the Rule 0 hits;
4. the OPEN residue rows that name a handoff path;
5. the open PRs on the branch suffix;
6. the board inbox.

 A section that cannot read its source says `unread:` and gives the reason. `tools/unit-launch.sh` now prompts each new session to run it first.
