<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [PulseDex]
brief: none
---
parseRRInput now resolves file-level DMY/MDY via DexClock.resolveDMY and honors an optional preferDMY — so Coospo/Wahoo MDY-stamped RR files parse ambiguous dates correctly (06/05/2026 → June 5, not May 6) instead of silently reading DMY.
