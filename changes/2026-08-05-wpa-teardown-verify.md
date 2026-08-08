<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: CAPTURE-HOST-DEEP-AUDIT-FOLLOWUPS-II-2026-08-05-BRIEF.md
---

`_wpa_down` warned "a supplicant may be left running" on every non-zero terminate, which on the live box
meant twice per cycle forever with nothing to leak — the normal `rc=255` when no control socket exists.
It now reads /proc and asks whether one is actually bound to `-i <iface>`: names the pid when one
survived, says "nothing to terminate" when none did, and never swallows the rc. Verified rather than
message-matched, because the real 2026-07-29 leak returned the same rc=255.
