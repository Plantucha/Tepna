<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: MEMORY-PROGRAM-2026-11-22-BRIEF.md
---
Make the STE linter read a `[[note-name]]` as a name, not as prose.

Over 819 memory notes, 96 of 2,351 findings sat inside such a link. A note cannot change the name of a note that it links.
