---
bump: patch
type: changed
brief: none
---

Ratchet the XSS backlog on unescaped SINKS (210 of 314) instead of files (42), because a file leaves the list only when its last sink is escaped — so the old baseline could not see a merged security fix.
