<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: security
nodes: [OxyDex, PulseDex]
brief: SECURITY-REMEDIATION-2026-07-11-BRIEF.md
---
Escape untrusted filenames/errors at the OxyDex + PulseDex innerHTML sinks (F1/F2/F3) via one shared dex-escape.js — a crafted `<img onerror>` capture name renders as inert text; display-only, EXPORT-INERT re-bundle (also folds on-touch Biome formatting of the touched files, BIOME-FORMATTER Phase 2).
