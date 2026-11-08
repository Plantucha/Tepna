---
bump: patch
type: fixed
brief: none
---

The board hook now blocks a fleet session's stop once while a decision addressed to that session waits for its ack. The block lists each entry with its thread and gives the ack command.

On 2026-11-07, 66 acks stood open on the board. The board re-delivers an unacked decision for only 7 days, and a delivery asks for nothing. The new check reads open decisions at every age, through the board's own module. A decision that the session wrote is not owed by it. The hatch is `CLAUDE_ALLOW_UNACKED=1`.
