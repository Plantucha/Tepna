<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [suite]
brief: DEEP-AUDIT-V-FOLLOWUPS-2026-08-05-BRIEF.md
---
`git checkout <ref> -- <conflicted>` is the mid-rebase shortcut every parallel PR reaches for, and it is correct for a generated artifact and destructive for a source file — silently, with a clean tree and a passing push. Measured: one such line reverted a test group, a DSP fix and a provenance entry out of one commit. Adds tools/rebase-safe.mjs (classifies by asking the BUILDERS which paths they own, auto-resolves generated, rebuilds, and STOPS on source), a guard-shared-tree.sh rule that denies the hand-rolled form at the moment it is typed, and CLAUDE.md §2c so it is read automatically.
