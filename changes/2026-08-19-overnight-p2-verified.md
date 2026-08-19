---
bump: patch
type: changed
---

**`VIGIL-OVERNIGHT-FINDINGS`' P2 list verified in code: five of six are SHIPPED, and the brief read as
fully open.** Same pattern as the DEEP-ANALYSIS phase map — a long audit with no status markers invites
redoing finished work, and each P2 item now carries its measured state:

- **P2.1** ✅ exponential backoff (`min(backoff*2, 300)` from 5 s), reset **only on a viable session** —
  a bare connect does not reset it, or a flapping link would pin it at the floor.
- **P2.2** ⛔ **the one real remaining item**: reconnects still mint a new file-set (15 Verity sets on
  2026-08-18 alone). An architecture change — its own brief when picked up.
- **P2.3** ✅ pulls gate on recovery/pause state.
- **P2.4** ✅ compute + surfaces everywhere, and the 2026-08-19 morning digest closed the push half.
- **P2.5** ✅ `pull_progress` set, cleared even on failure, surfaced.
- **P2.6** 〰 partial-but-differently-shaped: `link_epoch` rides the LINK sidecar + status (a *recorded*
  surface), but the literal ask — an INFO line with outage duration — is not implemented. Said rather
  than ticked.

Also corrects the header's own contradiction: its remainder list said **P1.4** while the same header
records P1.4 as DONE — it meant **P1.5** (dual-radio failover), which stays open and is now the section's
only large item; the box has two adapters today, so the premise holds.

No code change. Gate: docs-ledger 38/38.
