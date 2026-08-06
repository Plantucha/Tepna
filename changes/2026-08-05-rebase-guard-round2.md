<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: none
---
Close the three rebase-guard bypasses that survived #990/#991 — a traversing path still inherited the generated-prefix exemption in the hook, the ref clause knew only origin//HEAD/hex so a plain branch or tag walked past, and the heredoc strip could swallow a real checkout — and repair the self-invalidating `relaxed` assertion that had left the suite red on main.
