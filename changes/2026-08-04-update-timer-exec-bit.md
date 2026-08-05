<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
tepna-update.sh is committed executable — the unattended-deploy timer had never once run, failing 203/EXEC hourly while its 327 lines of tests passed by invoking it as `bash <script>`.
