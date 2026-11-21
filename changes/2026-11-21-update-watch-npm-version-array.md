---
bump: patch
type: fixed
brief: none
---

The update watcher reads an npm version again. `npm view <pkg> version --json` prints an array when several versions match. The reader kept that array, so the table's own formatter threw a `TypeError`. The throw came before the notify step. The watcher therefore posted no ready update at all, and its daily unit sat in the failed state.

One new pure helper takes the newest member that reads as a version, and it answers `null` when no member does. The formatter now renders any row shape, so one unreadable row cannot cost the whole table. Seven selftests pin both.
