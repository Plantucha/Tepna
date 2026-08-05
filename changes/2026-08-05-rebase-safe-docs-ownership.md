<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: DEEP-AUDIT-V-FOLLOWUPS-2026-08-05-BRIEF.md
---
rebase-safe classified the whole `docs/` prefix as generated, and that is false: build-docs writes a docs/ file only where a ROOT TWIN exists plus six artifacts, and filters `.md` out of its asset list — so ~30 archival docs are authored and owned by nobody. A conflict in one was auto-resolved by discarding your side, left unrestorable by the rebuild, and reported as ✓ — the tool committing the exact silent revert it exists to prevent, with a success message on top. build-docs.mjs gains `--list-owned` (implies --check, never writes) and the prefix guess is deleted. Also folds the hook self-test into `npm run check`, which a rollout note had already claimed and which was not true.
