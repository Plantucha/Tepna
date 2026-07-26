<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: VIGIL-HARDENING-II-2026-07-25-BRIEF.md
---
Never delete a night whose second copy cannot be confirmed, and write config.yaml atomically — retention gated on a verified mirror (not just the `.archived` marker), an unreadable night protected instead of swept, and a truncating config write replaced with mkstemp+fsync+os.replace.
