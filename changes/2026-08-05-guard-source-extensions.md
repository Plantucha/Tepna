<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [docs]
---

Adversarial pass on `guard-shared-tree.sh`'s source-checkout rule found three holes, all the
accidental form: the extension list omitted `.py`/`.sh` (all of capture-host), a quoted path bypassed
the match entirely, and the docs//provenance/ exemption was command-wide so one generated path
disabled the rule for the source beside it — the documented mixed-conflict-list scenario. Also: the
hook matrix and the rebase classifier were gated by NOTHING; `test:guards` now runs in `npm run check`
and a `rebase-safe` group pins the classifier's fail-closed behaviour (22 assertions, node lane).
