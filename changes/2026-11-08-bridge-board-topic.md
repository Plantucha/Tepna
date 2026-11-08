---
bump: patch
type: added
brief: NTFY-ALERT-WIRING-2026-11-03-BRIEF.md
---

The ntfy bridge subscribes to a per-domain board topic. The config names it under the top-level boardTopics key. A message on that topic posts to the domain thread as a note. It enters no episode, no tracked urgent and no escalation ladder. This completes the bridge side of the alert tiering in PR 4559. The vigil board topic value lives only in the host-local bridge config.
