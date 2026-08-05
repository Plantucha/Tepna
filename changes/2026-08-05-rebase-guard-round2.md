<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: none
---
Close 17 bypasses in the rebase-shortcut guard and gate it — the generated exemption was command-wide so a normal mixed conflict list disarmed the whole rule, the ref pattern knew only origin//HEAD/hex, authored non-JS source was not covered, docs/ is not a generated prefix, and neither the hook suite nor the classifier ran in `npm run check`.
