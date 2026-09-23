---
bump: minor
type: added
brief: none
---

tools/release-due.mjs + tools/systemd/tepna-release-due.{service,timer}: the release cuts itself — a release is DUE at 7 days since the last tag or 100 commits on main since it, whichever comes first (owner ruling 2026-09-23), and an hourly user timer on the corpus machine launches release.mjs --full when it is; the decision is a pure function with a selftest, refuses on an unreadable distance rather than reporting not-due, holds while a release-land run is recorded unfinished, and emits one tepna.verdict/1 that reads FAIL whenever a due release was not launched.
