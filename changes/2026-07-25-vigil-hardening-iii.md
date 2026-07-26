<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: VIGIL-HARDENING-III-2026-07-25-BRIEF.md
---
Drop a part-decoded PMD delta frame instead of stamping its survivors as the frame's tail (they were placed 96 ms late), and reject a MAC carrying a trailing newline so an uncapturable address can never be persisted.
