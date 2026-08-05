<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
---

`test_vigil_update`'s ExecStart= scan treated the venv interpreter as a repo script, so the capture-host
suite was RED on `main` for every developer and green in CI. The unit names
`/opt/tepna/capture-host/.venv/bin/python`, which is under `DEPLOY_ROOT` and therefore never excluded by
the prefix filter its comment credited; what excluded it was `.venv/` being absent, which is true only in
CI. Skipped explicitly, with a test that builds the developer's case (interpreter present on disk).
