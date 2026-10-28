---
bump: patch
type: changed
brief: none
---

Remove every home-directory path from the tracked tree. Executable code reads `homedir()`, `$HOME` or `Path.home()`, and `tools/home-paths.mjs` holds one definition and one selftest for each default. Docs, briefs and the dated audit records carry a `~/` prefix instead. Behaviour on this machine is unchanged, and git history is untouched.
