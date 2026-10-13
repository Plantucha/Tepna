---
bump: patch
type: fixed
brief: none
---

Ask `tools/tools-index.mjs` which `docs/` file it owns, so a conflict there auto-resolves. Keep `docs/MUTATION-INVENTORY.md` as source, because its builder stamps today and reads untracked journals. Fail closed when either builder cannot answer.
