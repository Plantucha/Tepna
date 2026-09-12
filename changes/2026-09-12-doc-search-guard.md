---
bump: patch
type: changed
nodes: [tooling]
brief: none
---
`tools/doc-search.mjs` leaves a per-session stamp after every search that ran; a new PreToolUse
`Edit|Write` hook (`guard-doc-search.sh`) denies a repo edit in a session with no fresh stamp.
Fails open where no local index exists (CI, fresh clones, other machines) — local rig coders only.
