---
bump: patch
type: fixed
brief: none
---

Six tools refuse an unrecognised flag by name at exit 2 instead of taking it as an input path — one of them had created a directory named `--help` and written five EDFs into it — `tools/argv-survey.mjs` no longer runs its sweep and exits the process when imported, and `wt-done --landed` retires a worktree whose branch was rebuilt or whose post-merge commits were refused by a date, by proving every identifier the branch added is present on `origin/main`.
