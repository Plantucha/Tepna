---
bump: patch
type: fixed
brief: none
---

Pair every module-scope `--selftest` read with the CLI entry guard, so importing a tool no longer runs its selftest on the importer's flags.
