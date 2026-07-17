<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [suite]
brief: TEST-COVERAGE-FOLLOWUPS-2026-07-17-BRIEF.md
---
Add a known-answer gate for the OverDex folder walker — pins fromInput's junk-filter (dotfiles/__MACOSX/.DS_Store dropped by name and by path segment), relPath tagging, and relOf fallback; the walker shipped in OverDex untested.
