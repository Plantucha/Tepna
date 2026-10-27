---
bump: patch
type: changed
brief: none
---
The population half of `corpus-scope.mjs` moves into `corpus-scope-core.mjs`, which writes, execs and fetches nothing. The commit read now parses `.git` instead of shelling out. The old `git rev-parse` reader stays beside the selftest as its oracle. Every delegating tool points at the core, so the probe-safe population grows from 41 tools to 67 with nothing lost.
