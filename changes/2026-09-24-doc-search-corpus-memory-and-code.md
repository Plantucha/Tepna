---
bump: minor
type: changed
brief: none
---

doc-search (Rule 0) now sees what it kept missing: the in-repo corpus adds capture-host/ (122 .py), its tests, tools/*.mjs, tests/, .claude/hooks/*.sh, changes/ and the systemd/deploy units; external roots take an optional depth so the fleet's memory directory (400 lessons), the rig's user units, herdr's config and the top-level ops scripts are indexed without re-walking every worktree under ~ (owner, 2026-09-24: 'setup bge to index Claude memory and necessary config files'); the hourly reindex driver indexes a dedicated always-current checkout instead of the shared root, which was 170 commits behind on a feature branch.
