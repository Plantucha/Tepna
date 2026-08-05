<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [PpgDex, Integrator]
brief: DEEP-AUDIT-V-2026-08-04-BRIEF.md
---
DexClock decides whether a host column is a real second clock or the device stamp rounded, and parsePPG dropped that verdict (`independent`/`spreadMs`/`inertReason`) at the export boundary — so every phone-captured night claimed `timingSource:'device+host'` while DexClock had said "this host column is not an independent clock". The three fields are now forwarded and the verdict is honoured: a real device axis whose host column adds nothing reports `device`, not `device+host`.
